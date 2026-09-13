import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_SCORING_SETTINGS, type ScoringSettings } from "../../src/shared/scoring";
import { RUBRIC_BANDS } from "../../src/shared/types";
import { evaluateDeck, type RawEvaluation } from "../../src/server/ai/evaluate";
import type { Env } from "../../src/server/types";

/**
 * W2-A — the admin console's **Scoring framework** and **Area weights**, at the
 * only level that matters: whether the settings actually change what the server
 * does. Every test here would still pass if the UI rendered nothing, and would
 * fail if a toggle were stored but ignored.
 *
 * NB (worker-test gotcha): storage is isolated per FILE, not per test, so every
 * fixture uses a unique id and each test restores the settings it changed.
 */

const BASE = "https://example.com";

const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const SUPER = "priya.sharma@demo.startupjury.ai"; // incubator superuser
const PA = "sunita.rao@demo.startupjury.ai"; // incubator program_associate
const JURY = "rajesh.kumar@demo.startupjury.ai"; // incubator jury
const FOUNDER = "meera.sharma@demo.startupjury.ai"; // incubator founder

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

function req(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });

/** Write the settings directly — the route is what several tests are testing. */
async function setScoring(patch: Partial<Record<string, number | string>>): Promise<void> {
  const cols = Object.keys(patch);
  if (cols.length === 0) return;
  await env.DB.prepare(
    `UPDATE org_scoring_settings SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE edition = 'incubator'`,
  )
    .bind(...cols.map((c) => patch[c]!))
    .run();
}

async function resetScoring(): Promise<void> {
  await setScoring({
    ai_pre_scoring_enabled: 1,
    auto_clarification: 1,
    show_ai_score_to_jury: 1,
    require_override_rationale: 1,
    override_rationale_delta: 2,
    jury_sees_peer_scores: 0,
    score_scale: "0-10",
    composite_formula: "weighted_average",
    ai_weight_pct: 40,
    shortlist_threshold: 7.0,
    show_three_score_view: 1,
    show_score_drift: 1,
    include_ai_evidence: 1,
    intro_call_ai_prompts: 1,
  });
}

async function seedDeck(id: string, status = "pending_ai"): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, r2_key, uploaded_by, founder, founder_email, founder_phone, city, sector, complete) " +
      "VALUES (?, 'incubator', 'ScopeCo', ?, ?, 'inc_founder', 'Ada Founder', 'ada@scopeco.example', '+91 98450 11111', 'Bengaluru', 'B2B SaaS', 1)",
  )
    .bind(id, status, `decks/${id}.pdf`)
    .run();
  await env.DECKS.put(`decks/${id}.pdf`, new Uint8Array([37, 80, 68, 70]));
}

async function paramKeys(): Promise<string[]> {
  const rows = (
    await env.DB.prepare(
      "SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 ORDER BY sort_order",
    ).all<{ key: string }>()
  ).results;
  return rows.map((r) => r.key);
}

/** Run a real evaluation with a stubbed model that scores every area `value`. */
async function aiEvaluate(id: string, value = 9): Promise<unknown> {
  const keys = await paramKeys();
  return evaluateDeck(env as unknown as Env, id, {
    callModel: async (): Promise<RawEvaluation> => ({
      complete: true,
      founder: "Ada Founder",
      founder_email: "ada@scopeco.example",
      founder_phone: "+91 98450 11111",
      city: "Bengaluru",
      sector: "B2B SaaS",
      extractions: [{ label: "Cover", heading: "ScopeCo", text: "One-liner" }],
      scores: keys.map((key) => ({ key, value })),
    }),
    now: () => "2026-09-09T00:00:00Z",
  });
}

async function statusOf(id: string): Promise<string> {
  const row = await env.DB.prepare("SELECT status FROM decks WHERE id = ?")
    .bind(id)
    .first<{ status: string }>();
  return row!.status;
}

beforeEach(resetScoring);

// ── The API ───────────────────────────────────────────────────────────────────

describe("GET /api/config/scoring", () => {
  it("serves the prototype's shipped defaults", async () => {
    const body = (await (await get("/api/config/scoring", await login(ADMIN))).json()) as {
      scoring: ScoringSettings;
      thresholdBest: number;
      thresholdMediocre: number;
      editable: boolean;
    };
    expect(body.scoring).toEqual(DEFAULT_SCORING_SETTINGS);
    // The two cohort bands stay on org_settings and are rendered in the same card.
    expect(body.thresholdBest).toBe(7);
    expect(body.thresholdMediocre).toBe(5);
    expect(body.editable).toBe(true);
  });

  it("is readable by staff who cannot edit it, and closed to founders", async () => {
    const jury = (await (await get("/api/config/scoring", await login(JURY))).json()) as {
      editable: boolean;
    };
    // A juror's workbench has to honour the 3-score view and the score scale.
    expect(jury.editable).toBe(false);
    expect((await get("/api/config/scoring", await login(FOUNDER))).status).toBe(403);
  });
});

describe("PUT /api/config/scoring-framework", () => {
  it("persists every control and rounds-trips through the read", async () => {
    const admin = await login(ADMIN);
    const next: ScoringSettings = {
      ...DEFAULT_SCORING_SETTINGS,
      aiPreScoringEnabled: false,
      autoClarification: false,
      showAiScoreToJury: false,
      overrideRationaleDelta: 1.5,
      jurySeesPeerScores: true,
      scoreScale: "1-5",
      compositeFormula: "median",
      aiWeightPct: 0,
      shortlistThreshold: 6.5,
      showScoreDrift: false,
      includeAiEvidence: false,
      introCallAiPrompts: false,
    };
    const res = await req("PUT", "/api/config/scoring-framework", admin, next);
    expect(res.status).toBe(200);
    const saved = (await (await get("/api/config/scoring", admin)).json()) as {
      scoring: ScoringSettings;
    };
    expect(saved.scoring).toEqual(next);
    await resetScoring();
  });

  it("re-scores the edition when the composition changes, and not otherwise", async () => {
    const admin = await login(ADMIN);
    const composition = await req("PUT", "/api/config/scoring-framework", admin, {
      ...DEFAULT_SCORING_SETTINGS,
      compositeFormula: "median",
    });
    expect(((await composition.json()) as { rescored: { decks: number } }).rescored.decks)
      .toBeGreaterThan(0);

    await resetScoring();
    const display = await req("PUT", "/api/config/scoring-framework", admin, {
      ...DEFAULT_SCORING_SETTINGS,
      showScoreDrift: false,
    });
    expect(((await display.json()) as { rescored: { decks: number } }).rescored.decks).toBe(0);
    await resetScoring();
  });

  it("validates every value the prototype's controls can produce", async () => {
    const admin = await login(ADMIN);
    const cases: [string, unknown][] = [
      ["invalid_score_scale", { ...DEFAULT_SCORING_SETTINGS, scoreScale: "1-7" }],
      ["invalid_composite_formula", { ...DEFAULT_SCORING_SETTINGS, compositeFormula: "mode" }],
      ["invalid_ai_weight", { ...DEFAULT_SCORING_SETTINGS, aiWeightPct: 45 }],
      ["invalid_shortlist_threshold", { ...DEFAULT_SCORING_SETTINGS, shortlistThreshold: 11 }],
      ["invalid_delta", { ...DEFAULT_SCORING_SETTINGS, overrideRationaleDelta: -1 }],
    ];
    for (const [code, body] of cases) {
      const res = await req("PUT", "/api/config/scoring-framework", admin, body);
      expect(res.status, code).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(code);
    }
  });

  it("is admin-only — a superuser passes, a program associate and a juror 403", async () => {
    expect(
      (await req("PUT", "/api/config/scoring-framework", await login(SUPER), DEFAULT_SCORING_SETTINGS))
        .status,
    ).toBe(200);
    for (const who of [PA, JURY, FOUNDER]) {
      const res = await req(
        "PUT",
        "/api/config/scoring-framework",
        await login(who),
        DEFAULT_SCORING_SETTINGS,
      );
      expect(res.status, who).toBe(403);
    }
    await resetScoring();
  });
});

// ── The behaviour each toggle is supposed to buy ──────────────────────────────

describe("ai_pre_scoring_enabled", () => {
  it("off → no model call at all, and the deck moves to human triage", async () => {
    await setScoring({ ai_pre_scoring_enabled: 0 });
    const id = "fw_no_ai";
    await seedDeck(id);
    let called = false;
    const result = (await evaluateDeck(env as unknown as Env, id, {
      callModel: async () => {
        called = true;
        throw new Error("the model must not be called with pre-scoring off");
      },
    })) as { aiSkipped?: boolean; status: string };
    expect(called).toBe(false);
    expect(result.aiSkipped).toBe(true);
    expect(result.status).toBe("manual_review");
    expect(await statusOf(id)).toBe("manual_review");

    // No AI scores were written, and the skip is in the audit trail.
    const scores = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM scores WHERE deck_id = ? AND evaluator_kind = 'ai'",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(scores!.n).toBe(0);
    const evt = await env.DB.prepare(
      "SELECT action FROM pipeline_events WHERE deck_id = ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(id)
      .first<{ action: string }>();
    expect(evt!.action).toBe("ai_skipped");
  });

  // Wave 2 integration. This path returned `signal: "absent"` — the retired
  // four-band key W2-B's 0039 renamed to `insufficient` and deleted from
  // SIGNAL_STYLES. `EvaluationResult.signal` is typed `string` and UploadPage
  // casts it, so typecheck saw nothing and the assertions above never read the
  // field; the Upload screen threw for any org with the toggle off. Neither
  // branch was wrong alone, which is why only the merged tree shows it.
  it("off → the signal it reports is a band the client can actually render", async () => {
    await setScoring({ ai_pre_scoring_enabled: 0 });
    const id = "fw_no_ai_signal";
    await seedDeck(id);
    const result = (await evaluateDeck(env as unknown as Env, id, {
      callModel: async () => {
        throw new Error("the model must not be called with pre-scoring off");
      },
    })) as { signal: string };
    expect(RUBRIC_BANDS.map((b) => b.key)).toContain(result.signal);
    expect(result.signal).toBe("insufficient");
  });

  it("off → re-score says so rather than pretending", async () => {
    await setScoring({ ai_pre_scoring_enabled: 0 });
    const res = await req(
      "POST",
      "/api/decks/inc_deck_taxpilot/rescore",
      await login(ADMIN),
      {},
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("ai_disabled");
  });
});

describe("composite_formula reaches the AI path", () => {
  it("a median org stores a median, not a weighted average", async () => {
    // Twelve areas at 9 and one at 0: the weighted average lands near 8, the
    // median is 9. Which number the deck ends up with proves the setting is read.
    const keys = await paramKeys();
    const core = (
      await env.DB.prepare(
        "SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 AND informational = 0 ORDER BY sort_order",
      ).all<{ key: string }>()
    ).results.map((r) => r.key);

    const runWith = async (id: string, formula: string): Promise<number> => {
      await setScoring({ composite_formula: formula });
      await seedDeck(id);
      await evaluateDeck(env as unknown as Env, id, {
        callModel: async (): Promise<RawEvaluation> => ({
          complete: true,
          founder: "Ada Founder",
          founder_email: "ada@scopeco.example",
          founder_phone: "+91 98450 11111",
          city: "Bengaluru",
          sector: "B2B SaaS",
          extractions: [{ label: "Cover", heading: "ScopeCo", text: "x" }],
          scores: keys.map((key) => ({ key, value: key === core[0] ? 0 : 9 })),
        }),
        now: () => "2026-09-09T00:00:00Z",
      });
      const row = await env.DB.prepare("SELECT ai_score FROM decks WHERE id = ?")
        .bind(id)
        .first<{ ai_score: number }>();
      return row!.ai_score;
    };

    const weighted = await runWith("fw_formula_w", "weighted_average");
    const median = await runWith("fw_formula_m", "median");
    expect(median).toBe(9);
    expect(weighted).toBeLessThan(9);
    expect(weighted).toBeGreaterThan(8);
  });
});

describe("auto_clarification", () => {
  it("on → a weak deck gets a query and an email without anyone asking", async () => {
    const id = "fw_auto_q";
    await seedDeck(id);
    await aiEvaluate(id, 2); // every area in the rubric's Insufficient band
    const q = await env.DB.prepare("SELECT questions FROM queries WHERE deck_id = ?")
      .bind(id)
      .first<{ questions: string }>();
    expect(q).toBeTruthy();
    expect(q!.questions).toContain("weak signal");
    const mail = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_outbox WHERE deck_id = ? AND kind = 'founder_query'",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(mail!.n).toBe(1);
  });

  it("off → the same deck gets nothing", async () => {
    await setScoring({ auto_clarification: 0 });
    const id = "fw_auto_q_off";
    await seedDeck(id);
    await aiEvaluate(id, 2);
    const q = await env.DB.prepare("SELECT COUNT(*) AS n FROM queries WHERE deck_id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(q!.n).toBe(0);
  });

  it("on → a strong deck gets nothing either: there is nothing to ask about", async () => {
    const id = "fw_auto_q_strong";
    await seedDeck(id);
    await aiEvaluate(id, 9);
    const q = await env.DB.prepare("SELECT COUNT(*) AS n FROM queries WHERE deck_id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(q!.n).toBe(0);
  });
});

describe("show_ai_score_to_jury — blind scoring is server-side", () => {
  it("withholds the AI breakdown from a juror who has not submitted", async () => {
    await setScoring({ show_ai_score_to_jury: 0 });
    const jury = await login(JURY);
    const id = "fw_blind_hold";
    await seedDeck(id, "jury_evaluation");
    await env.DB.prepare("UPDATE decks SET assigned_to = 'inc_jury' WHERE id = ?").bind(id).run();
    await aiEvaluate(id, 8);
    const body = (await (await get(`/api/decks/${id}`, jury)).json()) as {
      scores: unknown[];
      weightedTotal?: number;
      verdict?: string;
      aiScoreWithheld?: boolean;
      deck: { aiScore?: number };
    };
    // The PAYLOAD carries no AI numbers — not a hidden DOM node.
    expect(body.scores).toEqual([]);
    expect(body.weightedTotal).toBeUndefined();
    expect(body.verdict).toBeUndefined();
    expect(body.deck.aiScore).toBeUndefined();
    expect(body.aiScoreWithheld).toBe(true);
  });

  // Wave 2 integration. `withholdsAiScore` was applied only on GET /api/decks/:id,
  // so the LIST still returned aiScore, decisionScore and signal — and All decks is
  // the screen a juror passes through on the way to scoring. Withholding on the
  // detail route alone does not make scoring independent.
  it("withholds it on the deck LIST too, not only on the detail route", async () => {
    await setScoring({ show_ai_score_to_jury: 0 });
    const jury = await login(JURY);
    const id = "fw_blind_list";
    await seedDeck(id, "jury_evaluation");
    await env.DB.prepare("UPDATE decks SET assigned_to = 'inc_jury' WHERE id = ?").bind(id).run();
    await aiEvaluate(id, 8);

    const list = (await (await get("/api/decks", jury)).json()) as {
      decks: {
        id: string;
        aiScore?: number;
        decisionScore?: number;
        signal?: string;
        aiScoreWithheld?: boolean;
      }[];
    };
    const row = list.decks.find((d) => d.id === id);
    expect(row).toBeDefined();
    expect(row!.aiScore).toBeUndefined();
    expect(row!.decisionScore).toBeUndefined();
    expect(row!.signal).toBeUndefined();
    expect(row!.aiScoreWithheld).toBe(true);

    // An admin oversees rather than scores, so the list is unchanged for them.
    const adminList = (await (await get("/api/decks", await login(ADMIN))).json()) as {
      decks: { id: string; aiScore?: number }[];
    };
    expect(adminList.decks.find((d) => d.id === id)!.aiScore).toBeDefined();
  });

  it("reveals it to the same juror once they have submitted", async () => {
    await setScoring({ show_ai_score_to_jury: 0 });
    const jury = await login(JURY);
    // inc_jury has a seeded evaluation on InsureFlow; assert against a deck
    // where they have none, then give them one.
    const id = "fw_blind_reveal";
    await seedDeck(id, "jury_evaluation");
    await env.DB.prepare("UPDATE decks SET assigned_to = 'inc_jury' WHERE id = ?").bind(id).run();
    await aiEvaluate(id, 8);

    const before = (await (await get(`/api/decks/${id}`, jury)).json()) as {
      aiScoreWithheld?: boolean;
    };
    expect(before.aiScoreWithheld).toBe(true);

    const keys = await paramKeys();
    const submit = await req("POST", `/api/decks/${id}/evaluate`, jury, {
      scores: keys.map((key) => ({ key, value: 8 })),
    });
    expect(submit.status).toBe(200);

    const after = (await (await get(`/api/decks/${id}`, jury)).json()) as {
      aiScoreWithheld?: boolean;
      scores: unknown[];
    };
    expect(after.aiScoreWithheld).toBeUndefined();
    expect(after.scores.length).toBeGreaterThan(0);
  });

  it("does not withhold from an admin, who oversees rather than scores", async () => {
    await setScoring({ show_ai_score_to_jury: 0 });
    const id = "fw_blind_admin";
    await seedDeck(id, "jury_evaluation");
    await aiEvaluate(id, 8);
    const body = (await (await get(`/api/decks/${id}`, await login(ADMIN))).json()) as {
      scores: unknown[];
      aiScoreWithheld?: boolean;
    };
    expect(body.aiScoreWithheld).toBeUndefined();
    expect(body.scores.length).toBeGreaterThan(0);
  });
});

describe("require_override_rationale", () => {
  it("refuses a submit whose big overrides carry no rationale, and names them", async () => {
    const id = "fw_rationale";
    await seedDeck(id, "jury_evaluation");
    await env.DB.prepare("UPDATE decks SET assigned_to = 'inc_jury' WHERE id = ?").bind(id).run();
    await aiEvaluate(id, 9);

    const jury = await login(JURY);
    const keys = await paramKeys();
    const res = await req("POST", `/api/decks/${id}/evaluate`, jury, {
      scores: keys.map((key) => ({ key, value: 2 })), // 7 points off the AI's 9
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; parameters: string[]; delta: number };
    expect(body.error).toBe("rationale_required");
    expect(body.delta).toBe(2);
    expect(body.parameters.length).toBeGreaterThan(0);

    // With a rationale on every offending parameter it goes through.
    const ok = await req("POST", `/api/decks/${id}/evaluate`, jury, {
      scores: keys.map((key) => ({ key, value: 2, comment: "The deck contradicts this." })),
    });
    expect(ok.status).toBe(200);
  });

  it("lets a score INSIDE the delta through with no rationale", async () => {
    const id = "fw_rationale_ok";
    await seedDeck(id, "jury_evaluation");
    await env.DB.prepare("UPDATE decks SET assigned_to = 'inc_jury' WHERE id = ?").bind(id).run();
    await aiEvaluate(id, 9);
    const keys = await paramKeys();
    const res = await req("POST", `/api/decks/${id}/evaluate`, await login(JURY), {
      scores: keys.map((key) => ({ key, value: 7 })), // exactly 2 — not "greater than"
    });
    expect(res.status).toBe(200);
  });

  it("off → the same submit is accepted", async () => {
    await setScoring({ require_override_rationale: 0 });
    const id = "fw_rationale_off";
    await seedDeck(id, "jury_evaluation");
    await env.DB.prepare("UPDATE decks SET assigned_to = 'inc_jury' WHERE id = ?").bind(id).run();
    await aiEvaluate(id, 9);
    const keys = await paramKeys();
    const res = await req("POST", `/api/decks/${id}/evaluate`, await login(JURY), {
      scores: keys.map((key) => ({ key, value: 2 })),
    });
    expect(res.status).toBe(200);
  });
});

describe("score_scale reaches the submit path", () => {
  it("a 1–5 org's 4 is stored as the canonical 7.5", async () => {
    await setScoring({ score_scale: "1-5", require_override_rationale: 0 });
    const id = "fw_scale";
    await seedDeck(id, "jury_evaluation");
    await env.DB.prepare("UPDATE decks SET assigned_to = 'inc_jury' WHERE id = ?").bind(id).run();
    const keys = await paramKeys();
    const res = await req("POST", `/api/decks/${id}/evaluate`, await login(JURY), {
      scores: keys.map((key) => ({ key, value: 4 })),
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT value FROM scores WHERE deck_id = ? AND evaluator_kind = 'human' LIMIT 1",
    )
      .bind(id)
      .first<{ value: number }>();
    expect(row!.value).toBe(7.5);
    // …and the roll-up is on the canonical scale too, so thresholds still mean
    // what they say.
    expect(((await res.json()) as { weightedTotal: number }).weightedTotal).toBe(7.5);
  });
});

describe("show_score_drift", () => {
  it("off → the drift report carries no analysis", async () => {
    await setScoring({ show_score_drift: 0 });
    const body = (await (await get("/api/analytics/drift", await login(ADMIN))).json()) as {
      rows: unknown[];
      disabled?: boolean;
    };
    expect(body.disabled).toBe(true);
    expect(body.rows).toEqual([]);
  });

  it("on → it does", async () => {
    const body = (await (await get("/api/analytics/drift", await login(ADMIN))).json()) as {
      rows: unknown[];
      disabled?: boolean;
    };
    expect(body.disabled).toBeUndefined();
    expect(body.rows.length).toBeGreaterThan(0);
  });
});

describe("include_ai_evidence", () => {
  it("off → the report's AI cells lose their justification but keep the score", async () => {
    await setScoring({ include_ai_evidence: 0 });
    const body = (await (
      await get("/api/decks/inc_deck_insureflow/report", await login(ADMIN))
    ).json()) as { core: { cells: Record<string, { value: number; comment?: string }> }[] };
    const aiCells = body.core.map((r) => r.cells.ai).filter(Boolean);
    expect(aiCells.length).toBeGreaterThan(0);
    expect(aiCells.every((c) => c.comment === undefined)).toBe(true);
    expect(aiCells.every((c) => typeof c.value === "number")).toBe(true);
  });

  it("on → at least one AI cell carries its justification", async () => {
    const body = (await (
      await get("/api/decks/inc_deck_insureflow/report", await login(ADMIN))
    ).json()) as { core: { cells: Record<string, { comment?: string }> }[] };
    expect(body.core.some((r) => r.cells.ai?.comment)).toBe(true);
  });
});

describe("intro_call_ai_prompts", () => {
  async function anIntroCall(): Promise<string> {
    const row = await env.DB.prepare(
      "SELECT c.id FROM calls c JOIN decks d ON d.id = c.deck_id WHERE d.edition = 'incubator' LIMIT 1",
    ).first<{ id: string }>();
    return row!.id;
  }

  it("on → the call carries questions derived from the deck's own evaluation", async () => {
    const id = await anIntroCall();
    const body = (await (await get(`/api/calls/${id}/prompts`, await login(ADMIN))).json()) as {
      enabled: boolean;
      prompts: { topic: string; question: string }[];
    };
    expect(body.enabled).toBe(true);
    expect(Array.isArray(body.prompts)).toBe(true);
  });

  it("off → none, and the screen is told why", async () => {
    await setScoring({ intro_call_ai_prompts: 0 });
    const id = await anIntroCall();
    const body = (await (await get(`/api/calls/${id}/prompts`, await login(ADMIN))).json()) as {
      enabled: boolean;
      prompts: unknown[];
    };
    expect(body.enabled).toBe(false);
    expect(body.prompts).toEqual([]);
  });
});

// ── Area weights ─────────────────────────────────────────────────────────────

describe("Permit configuration (F0077)", () => {
  it("is seeded on parameter 1 of each owning role and nowhere else", async () => {
    const body = (await (await get("/api/config", await login(ADMIN))).json()) as {
      additionalParams: { id: string; roleScope?: string; configPermitted: boolean }[];
    };
    const permitted = body.additionalParams.filter((p) => p.configPermitted);
    expect(permitted).toHaveLength(3); // one per owning role
    expect(new Set(permitted.map((p) => p.roleScope))).toEqual(
      new Set(["program_associate", "program_manager", "jury"]),
    );
  });

  it("lets the OWNING role edit a permitted parameter, and only that one", async () => {
    const admin = await login(ADMIN);
    const jury = await login(JURY);
    const permitted = await env.DB.prepare(
      "SELECT id FROM parameters WHERE edition = 'incubator' AND role_scope = 'jury' AND config_permitted = 1 AND active = 1 LIMIT 1",
    ).first<{ id: string }>();
    const notPermitted = await env.DB.prepare(
      "SELECT id FROM parameters WHERE edition = 'incubator' AND role_scope = 'jury' AND config_permitted = 0 AND active = 1 LIMIT 1",
    ).first<{ id: string }>();

    // W8-B (§8 Q116) — a delegated edit is still configuration, so the juror's
    // own seat must allow the role parameters. The seeded juror holds a Standard
    // seat (0052): the grant alone is refused on plan, not on permission…
    expect(
      (await req("PUT", `/api/config/additional-params/${permitted!.id}`, jury, { name: "Moat" }))
        .status,
    ).toBe(402);
    // …and with a Premium seat the delegation behaves exactly as before.
    await env.DB.prepare("UPDATE users SET plan_tier = 'premium' WHERE email = ?").bind(JURY).run();

    expect(
      (await req("PUT", `/api/config/additional-params/${permitted!.id}`, jury, { name: "Moat" }))
        .status,
    ).toBe(200);
    expect(
      (await req("PUT", `/api/config/additional-params/${notPermitted!.id}`, jury, { name: "No" }))
        .status,
    ).toBe(403);

    // Another role's permitted parameter is still off limits.
    const pmPermitted = await env.DB.prepare(
      "SELECT id FROM parameters WHERE edition = 'incubator' AND role_scope = 'program_manager' AND config_permitted = 1 AND active = 1 LIMIT 1",
    ).first<{ id: string }>();
    expect(
      (await req("PUT", `/api/config/additional-params/${pmPermitted!.id}`, jury, { name: "No" }))
        .status,
    ).toBe(403);

    // Revoking the grant closes the door again.
    expect(
      (await req("PUT", `/api/config/additional-params/${permitted!.id}/permit`, admin, {
        permitted: false,
      })).status,
    ).toBe(200);
    expect(
      (await req("PUT", `/api/config/additional-params/${permitted!.id}`, jury, { name: "Nope" }))
        .status,
    ).toBe(403);
    await req("PUT", `/api/config/additional-params/${permitted!.id}/permit`, admin, {
      permitted: true,
    });
    await env.DB.prepare("UPDATE users SET plan_tier = 'standard' WHERE email = ?").bind(JURY).run();
  });

  it("granting is admin-only, and never applies to a core area", async () => {
    const admin = await login(ADMIN);
    const id = await env.DB.prepare(
      "SELECT id FROM parameters WHERE edition = 'incubator' AND role_scope = 'jury' AND active = 1 LIMIT 1",
    ).first<{ id: string }>();
    expect(
      (await req("PUT", `/api/config/additional-params/${id!.id}/permit`, await login(JURY), {
        permitted: true,
      })).status,
    ).toBe(403);

    const core = await env.DB.prepare(
      "SELECT id FROM parameters WHERE edition = 'incubator' AND informational = 0 LIMIT 1",
    ).first<{ id: string }>();
    expect(
      (await req("PUT", `/api/config/additional-params/${core!.id}/permit`, admin, {
        permitted: true,
      })).status,
    ).toBe(400);
  });
});

// ── Migration 0038 ───────────────────────────────────────────────────────────

describe("migration 0038", () => {
  it("bumped criteria_version, so a seeded deck can be re-scored again", async () => {
    // Before 0038 the guard compared a version 0025 never bumped, so every
    // seeded evaluation read as current and re-score answered 409.
    const org = await env.DB.prepare(
      "SELECT criteria_version FROM org_settings WHERE edition = 'incubator'",
    ).first<{ criteria_version: number }>();
    const evalRow = await env.DB.prepare(
      "SELECT scored_criteria_version FROM evaluations WHERE deck_id = 'inc_deck_taxpilot' AND evaluator_id IS NULL",
    ).first<{ scored_criteria_version: number | null }>();
    expect(org!.criteria_version).toBeGreaterThan(evalRow!.scored_criteria_version ?? 1);
  });

  it("removed the duplicate (edition, key) rows and made the collision impossible", async () => {
    const dupes = (
      await env.DB.prepare(
        "SELECT edition, key, COUNT(*) AS n FROM parameters WHERE active = 1 GROUP BY edition, key HAVING n > 1",
      ).all<{ n: number }>()
    ).results;
    expect(dupes).toEqual([]);

    const retired = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM parameters WHERE id IN ('inc_add_program_fit', 'vc_add_thesis_fit')",
    ).first<{ n: number }>();
    expect(retired!.n).toBe(0);

    // The partial unique index refuses a second ACTIVE row on the same key.
    const existing = await env.DB.prepare(
      "SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 LIMIT 1",
    ).first<{ key: string }>();
    await expect(
      env.DB.prepare(
        "INSERT INTO parameters (id, edition, key, name, weight, informational, sort_order, active) VALUES ('dupe_probe', 'incubator', ?, 'Dupe', 0, 1, 999, 1)",
      )
        .bind(existing!.key)
        .run(),
    ).rejects.toThrow();
  });

  it("re-seeded the 18 AI comments against the parameters they now sit under", async () => {
    const rows = (
      await env.DB.prepare(
        "SELECT id, comment FROM scores WHERE id IN ('ai_tp_add_jury_1', 'ai_wo_add_ic_3', 'ai_tp_add_pm_1')",
      ).all<{ id: string; comment: string }>()
    ).results;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.comment]));
    // `0014` wrote these against the pre-0025 names, so the demo explained
    // "Founder Resilience & Coachability" under a heading reading "Barriers of
    // entry". Each now describes the parameter it actually sits under.
    expect(byId.ai_tp_add_jury_1).toMatch(/switching costs/i); // Barriers of entry
    expect(byId.ai_wo_add_ic_3).toMatch(/acquirer/i); // Exit attractiveness
    expect(byId.ai_tp_add_pm_1).toMatch(/TRL/); // TRL stage

    // Nothing left describing a parameter that no longer exists.
    const stale = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM scores WHERE id LIKE 'ai_tp_add_%' OR id LIKE 'ai_wo_add_%'",
    ).first<{ n: number }>();
    expect(stale!.n).toBe(18);
  });
});
