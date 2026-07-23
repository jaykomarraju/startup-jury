import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { evaluateDeck, type RawEvaluation } from "../../src/server/ai/evaluate";
import type { Env } from "../../src/server/types";

const BASE = "https://example.com";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

// Seed logins (from migrations/0002_seed.sql).
const PA = "sunita.rao@demo.startupjury.ai"; // program_associate
const PM = "raj.kumar@demo.startupjury.ai"; // program_manager
const JURY = "rajesh.kumar@demo.startupjury.ai"; // jury
const FOUNDER = "meera.sharma@demo.startupjury.ai"; // founder
const SUPER = "priya.sharma@demo.startupjury.ai"; // superuser

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

async function seedDeck(
  id: string,
  status = "pending_ai",
  opts: { edition?: string; uploadedBy?: string; complete?: number } = {},
): Promise<void> {
  const { edition = "incubator", uploadedBy = "inc_founder", complete = 1 } = opts;
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, r2_key, uploaded_by, founder, complete) VALUES (?, ?, 'TestCo', ?, ?, ?, 'Ada Founder', ?)",
  )
    .bind(id, edition, status, `decks/${id}.pdf`, uploadedBy, complete)
    .run();
  await env.DECKS.put(`decks/${id}.pdf`, new Uint8Array([37, 80, 68, 70]));
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

async function statusOf(id: string): Promise<string> {
  const row = await env.DB.prepare("SELECT status FROM decks WHERE id = ?").bind(id).first<{ status: string }>();
  return row!.status;
}

async function aiEvaluateToPass(id: string): Promise<void> {
  const keys = await paramKeys();
  await evaluateDeck(env as Env, id, {
    callModel: async (): Promise<RawEvaluation> => ({
      complete: true,
      founder: "Ada Founder",
      extractions: [{ label: "Cover", heading: "TestCo", text: "One-liner" }],
      scores: keys.map((key) => ({ key, value: 9 })),
    }),
    now: () => "2026-07-22T00:00:00Z",
  });
}

describe("incubator happy path: upload → AI → assign → jury → shortlist → intro → signup → onboard", () => {
  it("drives a deck to onboard_ready with a full pipeline_events audit", async () => {
    const id = "pipe_happy";
    await seedDeck(id);
    const pa = await login(PA);
    const jury = await login(JURY);
    const founder = await login(FOUNDER);

    // AI evaluation passes the gate → ai_evaluated.
    await aiEvaluateToPass(id);
    expect(await statusOf(id)).toBe("ai_evaluated");

    // Associate assigns the jury member.
    const assignRes = await post(`/api/decks/${id}/assign`, pa, { assigneeId: "inc_jury" });
    expect(assignRes.status).toBe(200);
    expect(await statusOf(id)).toBe("assigned");

    // Jury submits human scores → advances into jury_evaluation.
    const keys = await paramKeys();
    const evalRes = await post(`/api/decks/${id}/evaluate`, jury, {
      scores: keys.map((key) => ({ key, value: 8 })),
      remarks: "Strong team",
    });
    expect(evalRes.status).toBe(200);
    const evalBody = (await evalRes.json()) as { weightedTotal: number; status: string };
    expect(evalBody.status).toBe("jury_evaluation");
    expect(evalBody.weightedTotal).toBe(8);

    // Human scores are persisted with evaluator_kind='human' + evaluator_id.
    const humanCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM scores WHERE deck_id = ? AND evaluator_kind = 'human' AND evaluator_id = 'inc_jury'",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(humanCount!.n).toBe(keys.length);

    // Jury shortlists → shortlisted.
    expect((await post(`/api/decks/${id}/transition`, jury, { action: "shortlist" })).status).toBe(200);
    expect(await statusOf(id)).toBe("shortlisted");

    // Associate schedules intro → intro.
    expect((await post(`/api/decks/${id}/transition`, pa, { action: "schedule_intro" })).status).toBe(200);
    expect(await statusOf(id)).toBe("intro");

    // Associate sends signup invite → signup + outbox row.
    expect((await post(`/api/decks/${id}/send-signup`, pa)).status).toBe(200);
    expect(await statusOf(id)).toBe("signup");
    const invite = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_outbox WHERE deck_id = ? AND kind = 'signup_invite'",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(invite!.n).toBe(1);

    // Founder completes signup → onboard_ready (terminal).
    expect((await post(`/api/decks/${id}/transition`, founder, { action: "complete_signup" })).status).toBe(200);
    expect(await statusOf(id)).toBe("onboard_ready");

    // Audit: events cover assign → jury eval → shortlist → intro → signup → onboard.
    const events = (await (await get(`/api/decks/${id}/events`, founder)).json()) as {
      events: Array<{ action: string; toStage: string }>;
    };
    const actions = events.events.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "assign_jury",
        "start_jury_eval",
        "shortlist",
        "schedule_intro",
        "send_signup",
        "complete_signup",
      ]),
    );
  });
});

describe("reject → archive branch", () => {
  it("jury rejects during evaluation, PM archives", async () => {
    const id = "pipe_reject";
    await seedDeck(id, "jury_evaluation");
    const jury = await login(JURY);
    const pm = await login(PM);

    expect((await post(`/api/decks/${id}/transition`, jury, { action: "reject" })).status).toBe(200);
    expect(await statusOf(id)).toBe("rejected");
    expect((await post(`/api/decks/${id}/transition`, pm, { action: "archive" })).status).toBe(200);
    expect(await statusOf(id)).toBe("archived");
  });
});

describe("founder query loop: incomplete → query → founder response → uploaded", () => {
  it("raises a query (stubbed email), founder answers, deck re-enters intake", async () => {
    const id = "pipe_query";
    await seedDeck(id, "incomplete", { complete: 0 });
    const pa = await login(PA);
    const founder = await login(FOUNDER);

    const createRes = await post(`/api/decks/${id}/queries`, pa, {
      questions: "What is your current MRR and churn?",
    });
    expect(createRes.status).toBe(200);
    const { queryId } = (await createRes.json()) as { queryId: string };

    // Stubbed email recorded in the outbox, linked to deck + query.
    const mail = await env.DB.prepare(
      "SELECT to_email, kind, status FROM email_outbox WHERE deck_id = ? AND query_id = ?",
    )
      .bind(id, queryId)
      .first<{ to_email: string; kind: string; status: string }>();
    expect(mail).toMatchObject({ kind: "founder_query", status: "sent" });

    // Founder responds → deck returns to Uploaded, complete flag reset.
    const respondRes = await post(`/api/queries/${queryId}/respond`, founder, {
      response: "MRR is $12k, churn 3%.",
    });
    expect(respondRes.status).toBe(200);
    expect(await statusOf(id)).toBe("uploaded");
    const q = await env.DB.prepare(
      "SELECT email_status, founder_response FROM queries WHERE id = ?",
    )
      .bind(queryId)
      .first<{ email_status: string; founder_response: string }>();
    expect(q).toMatchObject({ email_status: "answered" });
    expect(q!.founder_response).toContain("MRR");
  });

  it("raising a query on a manual_review deck flags it Incomplete first", async () => {
    const id = "pipe_query_mr";
    await seedDeck(id, "manual_review");
    const pa = await login(PA);
    await post(`/api/decks/${id}/queries`, pa, { questions: "Missing team slide?" });
    expect(await statusOf(id)).toBe("incomplete");
  });
});

describe("per-stage authorization", () => {
  it("jury cannot assign at the AI gate (403)", async () => {
    const id = "authz_assign";
    await seedDeck(id, "ai_evaluated");
    const jury = await login(JURY);
    const res = await post(`/api/decks/${id}/transition`, jury, { action: "assign_jury" });
    expect(res.status).toBe(403);
    expect(await statusOf(id)).toBe("ai_evaluated");
  });

  it("founder cannot shortlist during jury evaluation (403)", async () => {
    const id = "authz_shortlist";
    await seedDeck(id, "jury_evaluation");
    const founder = await login(FOUNDER);
    const res = await post(`/api/decks/${id}/transition`, founder, { action: "shortlist" });
    expect(res.status).toBe(403);
  });

  it("an unknown action from a stage is a 409", async () => {
    const id = "authz_unknown";
    await seedDeck(id, "shortlisted");
    const su = await login(SUPER);
    const res = await post(`/api/decks/${id}/transition`, su, { action: "nope" });
    expect(res.status).toBe(409);
  });

  it("a transition out of a terminal stage is a 409", async () => {
    const id = "authz_terminal";
    await seedDeck(id, "onboard_ready");
    const su = await login(SUPER);
    const res = await post(`/api/decks/${id}/transition`, su, { action: "archive" });
    expect(res.status).toBe(409);
  });

  it("the assign endpoint rejects non-associate roles (403)", async () => {
    const id = "authz_assign_ep";
    await seedDeck(id, "ai_evaluated");
    const jury = await login(JURY);
    const res = await post(`/api/decks/${id}/assign`, jury, { assigneeId: "inc_jury" });
    expect(res.status).toBe(403);
  });

  it("a founder cannot answer another founder's query (404 — deck not owned)", async () => {
    const id = "authz_query_owner";
    await seedDeck(id, "incomplete", { uploadedBy: "inc_pa" });
    const pa = await login(PA);
    const founder = await login(FOUNDER);
    const { queryId } = (await (
      await post(`/api/decks/${id}/queries`, pa, { questions: "?" })
    ).json()) as { queryId: string };
    const res = await post(`/api/queries/${queryId}/respond`, founder, { response: "x" });
    expect(res.status).toBe(404);
  });

  it("a founder cannot read another founder's queries or events (404)", async () => {
    const id = "authz_founder_read";
    await seedDeck(id, "incomplete", { uploadedBy: "inc_pa" });
    const founder = await login(FOUNDER);
    expect((await get(`/api/decks/${id}/queries`, founder)).status).toBe(404);
    expect((await get(`/api/decks/${id}/events`, founder)).status).toBe(404);
  });

  it("a jury member cannot score a deck assigned to someone else (403)", async () => {
    const id = "authz_jury_notmine";
    await seedDeck(id, "assigned");
    // assigned_to defaults to null (not inc_jury).
    const jury = await login(JURY);
    const keys = await paramKeys();
    const res = await post(`/api/decks/${id}/evaluate`, jury, {
      scores: keys.map((key) => ({ key, value: 6 })),
    });
    expect(res.status).toBe(403);
  });

  it("a program_manager is rejected by the assign endpoint gate (403)", async () => {
    const id = "authz_assign_pm";
    await seedDeck(id, "ai_evaluated");
    const pm = await login(PM);
    const res = await post(`/api/decks/${id}/assign`, pm, { assigneeId: "inc_jury" });
    expect(res.status).toBe(403);
  });

  it("cross-edition decks are invisible (404)", async () => {
    const id = "authz_cross";
    await seedDeck(id, "ai_evaluated", { edition: "vc", uploadedBy: "vc_analyst" });
    const pa = await login(PA); // incubator associate
    const res = await post(`/api/decks/${id}/transition`, pa, { action: "assign_jury" });
    expect(res.status).toBe(404);
  });
});

describe("deck list exposes per-role actions + status id", () => {
  it("includes statusId and the caller's allowed actions", async () => {
    const id = "list_actions";
    await seedDeck(id, "jury_evaluation");
    const jury = await login(JURY);
    const body = (await (await get("/api/decks", jury)).json()) as {
      decks: Array<{ id: string; statusId: string; actions: Array<{ action: string }> }>;
    };
    const deck = body.decks.find((d) => d.id === id)!;
    expect(deck.statusId).toBe("jury_evaluation");
    const actions = deck.actions.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["shortlist", "reject"]));
  });
});
