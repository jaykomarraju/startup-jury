import { SELF, env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { evaluateDeck, callAnthropic, type RawEvaluation } from "../../src/server/ai/evaluate";
import type { Env } from "../../src/server/types";

// Session 5 — Automation: the per-program shortlist floor, AI determinism, the
// soft duplicate / returning-company flags, upload validation (required founder
// columns → Incomplete) and deck versioning.
//
// NB (worker-test gotcha): storage is isolated per FILE, not per test — writes
// accumulate across `it`s here, so every fixture uses a unique id.

const BASE = "https://example.com";

// Seed logins (migrations/0002_seed.sql).
const PA = "sunita.rao@demo.startupjury.ai"; // incubator program_associate
const JURY = "rajesh.kumar@demo.startupjury.ai"; // incubator jury
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const SUPER = "priya.sharma@demo.startupjury.ai"; // incubator superuser
const FOUNDER = "meera.sharma@demo.startupjury.ai"; // incubator founder
const VC_ASSOCIATE = "sunita.rao.vc@demo.startupjury.ai"; // vc associate

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

function post(path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

function get(path: string, cookie: string) {
  return SELF.fetch(`${BASE}${path}`, { headers: { cookie } });
}

function postForm(path: string, cookie: string, form: FormData) {
  return SELF.fetch(`${BASE}${path}`, { method: "POST", headers: { cookie }, body: form });
}

function pdf(name: string): File {
  return new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });
}

async function paramKeys(edition = "incubator"): Promise<string[]> {
  const rows = (
    await env.DB.prepare(
      "SELECT key FROM parameters WHERE edition = ? AND active = 1 ORDER BY sort_order",
    )
      .bind(edition)
      .all<{ key: string }>()
  ).results;
  return rows.map((r) => r.key);
}

/** Create a program with an optional shortlist floor. */
async function seedProgram(id: string, name: string, min: number | null, edition = "incubator") {
  await env.DB.prepare(
    "INSERT INTO programs (id, edition, name, shortlist_min, active, sort_order) VALUES (?, ?, ?, ?, 1, 99)",
  )
    .bind(id, edition, name, min)
    .run();
}

interface SeedDeckOpts {
  edition?: string;
  status?: string;
  programId?: string | null;
  aiScore?: number | null;
  assignedTo?: string | null;
  uploadedBy?: string;
  fundingStage?: string | null;
  founder?: string | null;
  founderEmail?: string | null;
  founderPhone?: string | null;
  city?: string | null;
  sector?: string | null;
  withPdf?: boolean;
}

async function seedDeck(id: string, opts: SeedDeckOpts = {}): Promise<void> {
  const {
    edition = "incubator",
    status = "pending_ai",
    programId = null,
    aiScore = null,
    assignedTo = null,
    uploadedBy = "inc_pa",
    fundingStage = "Seed",
    founder = "Ada Founder",
    founderEmail = null,
    founderPhone = null,
    city = null,
    sector = null,
    withPdf = true,
  } = opts;
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, stage, city, sector, founder, founder_email, founder_phone, " +
      "program_id, status, ai_score, assigned_to, r2_key, uploaded_by, complete) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
  )
    .bind(
      id,
      edition,
      `Deck ${id}`,
      fundingStage,
      city,
      sector,
      founder,
      founderEmail,
      founderPhone,
      programId,
      status,
      aiScore,
      assignedTo,
      withPdf ? `decks/${id}.pdf` : null,
      uploadedBy,
    )
    .run();
  if (withPdf) await env.DECKS.put(`decks/${id}.pdf`, new Uint8Array([37, 80, 68, 70]));
}

// ── 1. Per-program shortlist floor ───────────────────────────────────────────

describe("per-program shortlist floor", () => {
  it("blocks a juror shortlisting a deck below the program's minimum", async () => {
    await seedProgram("prog_floor_hi", "High Bar Program", 7.5);
    await seedDeck("sl_below", {
      status: "jury_evaluation",
      programId: "prog_floor_hi",
      aiScore: 6.0,
      assignedTo: "inc_jury",
    });

    const cookie = await login(JURY);
    const res = await post("/api/decks/sl_below/transition", cookie, { action: "shortlist" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      message: string;
      score: number;
      minimum: number;
      programName: string;
    };
    expect(body.error).toBe("below_shortlist_minimum");
    expect(body.minimum).toBe(7.5);
    expect(body.score).toBe(6);
    expect(body.programName).toBe("High Bar Program");
    expect(body.message).toContain("Below the program's shortlist minimum");

    // The deck did not move.
    const row = await env.DB.prepare("SELECT status FROM decks WHERE id = 'sl_below'").first<{
      status: string;
    }>();
    expect(row!.status).toBe("jury_evaluation");
  });

  it("allows the shortlist once the deck clears the floor", async () => {
    await seedProgram("prog_floor_lo", "Low Bar Program", 5.0);
    await seedDeck("sl_above", {
      status: "jury_evaluation",
      programId: "prog_floor_lo",
      aiScore: 8.0,
      assignedTo: "inc_jury",
    });
    const cookie = await login(JURY);
    const res = await post("/api/decks/sl_above/transition", cookie, { action: "shortlist" });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT status FROM decks WHERE id = 'sl_above'").first<{
      status: string;
    }>();
    expect(row!.status).toBe("shortlisted");
  });

  it("judges the deck on the AI + jury average, not the AI score alone", async () => {
    // AI 8.0 alone would clear a 7.0 floor; a harsh jury 5.0 drags the decision
    // score to 6.5 — the number the evaluator sees in the Average column.
    await seedProgram("prog_floor_avg", "Average Program", 7.0);
    await seedDeck("sl_avg", {
      status: "jury_evaluation",
      programId: "prog_floor_avg",
      aiScore: 8.0,
      assignedTo: "inc_jury",
    });
    await env.DB.prepare(
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict) VALUES ('ev_sl_avg', 'sl_avg', 'inc_jury', 5.0, 'scored')",
    ).run();

    const cookie = await login(JURY);
    const res = await post("/api/decks/sl_avg/transition", cookie, { action: "shortlist" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { score: number }).score).toBe(6.5);
  });

  it("blocks an unscored deck when a floor is set", async () => {
    await seedProgram("prog_floor_unscored", "Unscored Program", 5.0);
    await seedDeck("sl_unscored", {
      status: "jury_evaluation",
      programId: "prog_floor_unscored",
      aiScore: null,
      assignedTo: "inc_jury",
    });
    const cookie = await login(JURY);
    const res = await post("/api/decks/sl_unscored/transition", cookie, { action: "shortlist" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toContain("no score yet");
  });

  it("does not block when the program has no floor, or the deck has no program", async () => {
    await seedProgram("prog_no_floor", "Open Program", null);
    await seedDeck("sl_nofloor", {
      status: "jury_evaluation",
      programId: "prog_no_floor",
      aiScore: 1.0,
      assignedTo: "inc_jury",
    });
    await seedDeck("sl_noprogram", {
      status: "jury_evaluation",
      programId: null,
      aiScore: 1.0,
      assignedTo: "inc_jury",
    });
    const cookie = await login(JURY);
    expect((await post("/api/decks/sl_nofloor/transition", cookie, { action: "shortlist" })).status).toBe(200);
    expect((await post("/api/decks/sl_noprogram/transition", cookie, { action: "shortlist" })).status).toBe(200);
  });

  it("is uniform — a superuser is held to the same floor", async () => {
    await seedProgram("prog_floor_super", "Uniform Program", 9.0);
    await seedDeck("sl_super", {
      status: "jury_evaluation",
      programId: "prog_floor_super",
      aiScore: 6.0,
    });
    const cookie = await login(SUPER);
    const res = await post("/api/decks/sl_super/transition", cookie, { action: "shortlist" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("below_shortlist_minimum");
  });

  it("applies to the VC shortlist-to-partner action too", async () => {
    await seedProgram("prog_vc_floor", "VC High Bar", 8.0, "vc");
    await seedDeck("sl_vc", {
      edition: "vc",
      status: "associate_review",
      programId: "prog_vc_floor",
      aiScore: 7.0,
      uploadedBy: "vc_analyst",
    });
    const cookie = await login(VC_ASSOCIATE);
    const res = await post("/api/decks/sl_vc/transition", cookie, { action: "shortlist_to_partner" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("below_shortlist_minimum");
  });

  it("leaves non-shortlist transitions alone", async () => {
    await seedProgram("prog_floor_reject", "Reject Program", 9.5);
    await seedDeck("sl_reject", {
      status: "jury_evaluation",
      programId: "prog_floor_reject",
      aiScore: 2.0,
      assignedTo: "inc_jury",
    });
    const cookie = await login(JURY);
    // Rejecting a low-scoring deck must never be blocked by the shortlist floor.
    expect((await post("/api/decks/sl_reject/transition", cookie, { action: "reject" })).status).toBe(200);
  });

  it("surfaces the floor and the decision score on the deck view", async () => {
    await seedProgram("prog_floor_view", "Viewable Program", 7.5);
    await seedDeck("sl_view", {
      status: "jury_evaluation",
      programId: "prog_floor_view",
      aiScore: 6.0,
      assignedTo: "inc_jury",
    });
    const cookie = await login(PA);
    const body = (await (await get("/api/decks/sl_view", cookie)).json()) as {
      deck: { shortlistMin?: number; decisionScore?: number; shortlistBlocked?: boolean };
    };
    expect(body.deck.shortlistMin).toBe(7.5);
    expect(body.deck.decisionScore).toBe(6);
    expect(body.deck.shortlistBlocked).toBe(true);
  });
});

describe("program shortlist_min API", () => {
  it("persists a floor, validates the range and clears it on blank", async () => {
    const cookie = await login(ADMIN);
    const created = await post("/api/programs", cookie, { name: "Floor CRUD", shortlistMin: 6.5 });
    expect(created.status).toBe(200);
    const { program } = (await created.json()) as { program: { id: string; shortlistMin?: number } };
    expect(program.shortlistMin).toBe(6.5);

    // Out of the 0–10 rubric range.
    const bad = await SELF.fetch(`${BASE}/api/programs/${program.id}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ shortlistMin: 42 }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_shortlist_min");

    // Blank clears the floor — the escape hatch for a deck held back by it.
    const cleared = await SELF.fetch(`${BASE}/api/programs/${program.id}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ shortlistMin: "" }),
    });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { program: { shortlistMin?: number } }).program.shortlistMin).toBeUndefined();
  });

  it("keeps the floor when the key is absent from a partial update", async () => {
    const cookie = await login(ADMIN);
    const { program } = (await (
      await post("/api/programs", cookie, { name: "Partial Update", shortlistMin: 7 })
    ).json()) as { program: { id: string } };
    const res = await SELF.fetch(`${BASE}/api/programs/${program.id}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ description: "renamed only" }),
    });
    expect(((await res.json()) as { program: { shortlistMin?: number } }).program.shortlistMin).toBe(7);
  });
});

// ── 2. AI determinism ────────────────────────────────────────────────────────

describe("AI determinism", () => {
  it("sends thinking disabled and a forced tool, and NO sampling params", async () => {
    const seen: { body: Record<string, unknown> } = { body: {} };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      seen.body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          content: [{ type: "tool_use", name: "submit_evaluation", input: { complete: true } }],
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    try {
      await callAnthropic({
        apiKey: "sk-test",
        model: "claude-sonnet-5",
        system: "sys",
        userText: "user",
        pdfBase64: "JVBERg==",
        tool: { name: "submit_evaluation", description: "d", input_schema: {} },
      });
    } finally {
      fetchSpy.mockRestore();
    }
    expect(seen.body.thinking).toEqual({ type: "disabled" });
    expect(seen.body.tool_choice).toEqual({ type: "tool", name: "submit_evaluation" });
    // Session 5 sent `temperature: 0` for determinism; claude-sonnet-5 rejects
    // non-default sampling parameters with a 400 ("temperature is deprecated for
    // this model"), which failed every live evaluation and stranded the deck at
    // pending_ai — the §9 symptom. Locked so it can't come back.
    expect(seen.body).not.toHaveProperty("temperature");
    expect(seen.body).not.toHaveProperty("top_p");
    expect(seen.body).not.toHaveProperty("top_k");
  });

  it("produces an identical composite across repeated runs of the same input", async () => {
    // The model seam is deterministic in tests; this locks the fact that nothing
    // in our own pipeline (ordering, rounding, the full-weight denominator)
    // introduces run-to-run drift.
    await seedDeck("det_a", { city: "Pune", sector: "SaaS", founderEmail: "a@b.com", founderPhone: "9845000000" });
    const keys = await paramKeys();
    const callModel = async (): Promise<RawEvaluation> => ({
      complete: true,
      founder: "Ada Founder",
      scores: keys.map((key, i) => ({ key, value: (i % 5) + 5 })),
    });
    const first = await evaluateDeck(env as Env, "det_a", { callModel });
    const second = await evaluateDeck(env as Env, "det_a", { callModel });
    expect(second.weightedTotal).toBe(first.weightedTotal);
    expect(second.signal).toBe(first.signal);
  });
});

// ── 3. Upload validation → Incomplete ────────────────────────────────────────

describe("upload validation (required founder columns)", () => {
  const keysFor = (keys: string[], value: number) => keys.map((key) => ({ key, value }));

  it("marks a high-scoring deck Incomplete when a required column is missing", async () => {
    await seedDeck("val_missing");
    const keys = await paramKeys();
    const result = await evaluateDeck(env as Env, "val_missing", {
      callModel: async (): Promise<RawEvaluation> => ({
        complete: true,
        founder: "Ada Founder",
        founder_email: "ada@testco.example",
        // phone / city / sector not stated in the deck
        scores: keysFor(keys, 9),
      }),
    });
    expect(result.weightedTotal).toBe(9);
    expect(result.gatePassed).toBe(false);
    expect(result.status).toBe("incomplete");
    expect(result.missingFields).toEqual(["founderPhone", "city", "sector"]);

    const row = await env.DB.prepare(
      "SELECT status, complete, missing_fields, founder_email FROM decks WHERE id = 'val_missing'",
    ).first<{ status: string; complete: number; missing_fields: string; founder_email: string }>();
    expect(row).toMatchObject({
      status: "incomplete",
      complete: 0,
      missing_fields: "founderPhone,city,sector",
      founder_email: "ada@testco.example",
    });
  });

  it("advances a deck whose details are complete", async () => {
    await seedDeck("val_complete");
    const keys = await paramKeys();
    const result = await evaluateDeck(env as Env, "val_complete", {
      callModel: async (): Promise<RawEvaluation> => ({
        complete: true,
        founder: "Ada Founder",
        founder_email: "ada@testco.example",
        founder_phone: "+91 98450 12345",
        city: "Bengaluru",
        sector: "B2B SaaS",
        scores: keysFor(keys, 9),
      }),
    });
    expect(result.missingFields).toEqual([]);
    expect(result.status).toBe("ai_evaluated");
  });

  it("lets the uploader's typed value win over the extraction", async () => {
    await seedDeck("val_typed", {
      founder: "Meera Sharma",
      founderEmail: "meera@nimbus.com",
      founderPhone: "9845012345",
      city: "Bengaluru",
      sector: "HR Tech",
    });
    const keys = await paramKeys();
    const result = await evaluateDeck(env as Env, "val_typed", {
      callModel: async (): Promise<RawEvaluation> => ({
        complete: true,
        founder: "M. S.",
        founder_email: "wrong@example.com",
        founder_phone: "0000000",
        city: "Nowhere",
        sector: "Unknown",
        scores: keysFor(keys, 9),
      }),
    });
    expect(result.details.founderEmail).toBe("meera@nimbus.com");
    expect(result.details.city).toBe("Bengaluru");
    expect(result.status).toBe("ai_evaluated");
  });

  it("keeps the deck Incomplete when the model itself flags it, details or not", async () => {
    await seedDeck("val_flagged");
    const keys = await paramKeys();
    const result = await evaluateDeck(env as Env, "val_flagged", {
      callModel: async (): Promise<RawEvaluation> => ({
        complete: false,
        founder: "Ada Founder",
        founder_email: "ada@testco.example",
        founder_phone: "9845012345",
        city: "Bengaluru",
        sector: "B2B SaaS",
        scores: keysFor(keys, 9),
      }),
    });
    expect(result.missingFields).toEqual([]);
    expect(result.status).toBe("incomplete");
  });
});

// ── 4. Duplicate / returning flags ───────────────────────────────────────────

describe("duplicate / returning-company flags", () => {
  it("raises a soft duplicate alert on a single upload without blocking it", async () => {
    await seedDeck("dup_original", {
      status: "jury_evaluation",
      fundingStage: "Seed",
      founder: "Ada Founder",
    });
    await env.DB.prepare("UPDATE decks SET name = 'OrbitPay' WHERE id = 'dup_original'").run();

    const cookie = await login(PA);
    const form = new FormData();
    form.set("file", pdf("orbitpay.pdf"));
    form.set("name", "OrbitPay Technologies Pvt Ltd");
    form.set("stage", "Seed");
    const res = await postForm("/api/decks/upload", cookie, form);
    // No AI key in tests → 202 pending, but the deck IS stored and flagged.
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      deckId: string;
      matches?: Array<{ flag: string; reason: string }>;
    };
    expect(body.matches?.[0].flag).toBe("duplicate");
    expect(body.matches?.[0].reason).toContain("OrbitPay");

    const row = await env.DB.prepare(
      "SELECT intake_flag, related_deck_id FROM decks WHERE id = ?",
    )
      .bind(body.deckId)
      .first<{ intake_flag: string; related_deck_id: string }>();
    expect(row).toMatchObject({ intake_flag: "duplicate", related_deck_id: "dup_original" });
  });

  it("tags a known company returning at a new stage", async () => {
    await seedDeck("ret_original", { status: "archived", fundingStage: "Seed" });
    await env.DB.prepare("UPDATE decks SET name = 'LumenAI' WHERE id = 'ret_original'").run();

    const cookie = await login(PA);
    const form = new FormData();
    form.set("file", pdf("lumen.pdf"));
    form.set("name", "Lumen AI");
    form.set("stage", "Series A");
    const body = (await (await postForm("/api/decks/upload", cookie, form)).json()) as {
      deckId: string;
      matches?: Array<{ flag: string }>;
    };
    expect(body.matches?.[0].flag).toBe("returning");
  });

  it("re-checks after extraction, so a bulk upload's founder email still matches", async () => {
    await seedDeck("dup_by_email", {
      status: "jury_evaluation",
      founderEmail: "zara@vaultly.com",
      fundingStage: "Seed",
    });
    // A bulk deck arrives with only a filename; the extraction supplies the email.
    await seedDeck("dup_bulk_new", { fundingStage: "Seed", founder: null });
    const keys = await paramKeys();
    const result = await evaluateDeck(env as Env, "dup_bulk_new", {
      callModel: async (): Promise<RawEvaluation> => ({
        complete: true,
        founder: "Zara Khan",
        founder_email: "Zara@Vaultly.com",
        founder_phone: "9845033333",
        city: "Mumbai",
        sector: "FinTech",
        scores: keys.map((key) => ({ key, value: 8 })),
      }),
    });
    expect(result.intakeFlag).toBe("duplicate");
    expect(result.intakeNote).toContain("email");
    // Soft alert only — the deck still advanced on its score.
    expect(result.status).toBe("ai_evaluated");
  });
});

// ── 5. Deck versioning ───────────────────────────────────────────────────────

describe("deck versioning", () => {
  it("records v1 on the initial upload", async () => {
    const cookie = await login(PA);
    const form = new FormData();
    form.set("file", pdf("v1deck.pdf"));
    form.set("name", "VersionCo");
    const { deckId } = (await (await postForm("/api/decks/upload", cookie, form)).json()) as {
      deckId: string;
    };
    const body = (await (await get(`/api/decks/${deckId}/versions`, cookie)).json()) as {
      versions: Array<{ version: number; fileName?: string; note?: string }>;
    };
    expect(body.versions).toHaveLength(1);
    expect(body.versions[0]).toMatchObject({ version: 1, fileName: "v1deck.pdf", note: "Initial upload" });
  });

  it("saves a re-upload as a new version, bumps content_version and re-points r2_key", async () => {
    await seedDeck("ver_deck", { status: "incomplete" });
    await env.DB.prepare(
      "INSERT INTO deck_versions (id, deck_id, version, r2_key, note) VALUES ('ver_deck_v1', 'ver_deck', 1, 'decks/ver_deck.pdf', 'Initial upload')",
    ).run();

    const cookie = await login(PA);
    const form = new FormData();
    form.set("file", pdf("updated.pdf"));
    form.set("note", "Added traction + team slides");
    const res = await postForm("/api/decks/ver_deck/version", cookie, form);
    expect([200, 202]).toContain(res.status);
    expect(((await res.json()) as { version: number }).version).toBe(2);

    const deck = await env.DB.prepare(
      "SELECT r2_key, content_version FROM decks WHERE id = 'ver_deck'",
    ).first<{ r2_key: string; content_version: number }>();
    expect(deck).toMatchObject({ r2_key: "decks/ver_deck_v2.pdf", content_version: 2 });
    // Both versions' objects survive — the history is real, not a overwrite.
    expect(await env.DECKS.get("decks/ver_deck.pdf")).not.toBeNull();
    expect(await env.DECKS.get("decks/ver_deck_v2.pdf")).not.toBeNull();

    const history = (await (await get("/api/decks/ver_deck/versions", cookie)).json()) as {
      versions: Array<{ version: number; note?: string; uploadedByName?: string }>;
    };
    expect(history.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(history.versions[0].note).toBe("Added traction + team slides");
    expect(history.versions[0].uploadedByName).toBe("Sunita Rao");
  });

  it("unblocks the AI rescore guard (a new version is a content change)", async () => {
    await seedDeck("ver_rescore", { status: "ai_evaluated" });
    const keys = await paramKeys();
    // Score it once so the guard has a prior AI evaluation to compare against.
    await evaluateDeck(env as Env, "ver_rescore", {
      callModel: async (): Promise<RawEvaluation> => ({
        complete: true,
        founder: "Ada Founder",
        founder_email: "ada@testco.example",
        founder_phone: "9845012345",
        city: "Bengaluru",
        sector: "B2B SaaS",
        scores: keys.map((key) => ({ key, value: 8 })),
      }),
    });
    const cookie = await login(PA);
    // Nothing changed yet → the guard blocks.
    expect((await post("/api/decks/ver_rescore/rescore", cookie)).status).toBe(409);

    const form = new FormData();
    form.set("file", pdf("v2.pdf"));
    await postForm("/api/decks/ver_rescore/version", cookie, form);

    // The content version moved, so a re-score is now a legitimate request. With
    // no API key configured the re-run fails at the model call (502), which still
    // proves the guard let it through rather than returning 409 already_scored.
    const after = await post("/api/decks/ver_rescore/rescore", cookie);
    expect(after.status).not.toBe(409);
  });

  it("scopes a founder to their own deck", async () => {
    await seedDeck("ver_other_founder", { uploadedBy: "inc_pa" });
    const cookie = await login(FOUNDER);
    const form = new FormData();
    form.set("file", pdf("nope.pdf"));
    expect((await postForm("/api/decks/ver_other_founder/version", cookie, form)).status).toBe(404);
  });

  it("rejects a non-PDF re-upload", async () => {
    await seedDeck("ver_bad_type");
    const cookie = await login(PA);
    const form = new FormData();
    form.set("file", new File(["hello"], "notes.txt", { type: "text/plain" }));
    const res = await postForm("/api/decks/ver_bad_type/version", cookie, form);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("pdf_required");
  });
});

// ── Bulk per-row errors ──────────────────────────────────────────────────────

describe("bulk upload per-row errors", () => {
  it("uploads the valid decks and reports the rejected files", async () => {
    const cookie = await login(PA);
    const form = new FormData();
    form.append("files", pdf("good-one.pdf"));
    form.append("files", new File(["nope"], "spreadsheet.csv", { type: "text/csv" }));
    form.append("files", pdf("good-two.pdf"));

    const res = await postForm("/api/decks/bulk", cookie, form);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      count: number;
      results: Array<{ file: string; ok: boolean; error?: string }>;
    };
    expect(body.count).toBe(2);
    const rejected = body.results.filter((r) => !r.ok);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ file: "spreadsheet.csv", error: "pdf_required" });
    expect(body.results.filter((r) => r.ok).map((r) => r.file).sort()).toEqual([
      "good-one.pdf",
      "good-two.pdf",
    ]);
  });

  it("400s only when every file is rejected", async () => {
    const cookie = await login(PA);
    const form = new FormData();
    form.append("files", new File(["nope"], "a.csv", { type: "text/csv" }));
    const res = await postForm("/api/decks/bulk", cookie, form);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; results: Array<{ file: string }> };
    expect(body.error).toBe("pdf_required");
    expect(body.results[0].file).toBe("a.csv");
  });
});
