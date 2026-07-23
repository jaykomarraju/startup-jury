import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

// Seed VC logins (from migrations/0002_seed.sql).
const MP = "aarav.khanna@demo.startupjury.ai"; // superuser / Managing Partner
const ADMIN = "nisha.kapoor.vc@demo.startupjury.ai"; // admin
const PARTNER = "ishaan.sethi@demo.startupjury.ai"; // partner
const IC = "rajesh.kumar.vc@demo.startupjury.ai"; // ic_member
const ASSOCIATE = "sunita.rao.vc@demo.startupjury.ai"; // associate
const ANALYST = "rhea.nair@demo.startupjury.ai"; // analyst

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

async function seedVcDeck(id: string, status = "analyst_scoring"): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, ai_score, signal, r2_key, uploaded_by, complete) " +
      "VALUES (?, 'vc', 'TestCo', ?, 7.5, 'moderate', ?, 'vc_analyst', 1)",
  )
    .bind(id, status, `decks/${id}.pdf`)
    .run();
}

async function statusOf(id: string): Promise<string> {
  const row = await env.DB.prepare("SELECT status FROM decks WHERE id = ?").bind(id).first<{ status: string }>();
  return row!.status;
}

async function paramKeys(): Promise<string[]> {
  const rows = (
    await env.DB.prepare("SELECT key FROM parameters WHERE edition = 'vc' AND active = 1 ORDER BY sort_order")
      .all<{ key: string }>()
  ).results;
  return rows.map((r) => r.key);
}

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return row!.n;
}

describe("VC happy path: analyst → associate → partner → IC → MP → term sheet → onboard", () => {
  it("drives a deck to onboard_ready with the full audit + domain-table side effects", async () => {
    const id = "vc_happy";
    await seedVcDeck(id);
    const analyst = await login(ANALYST);
    const associate = await login(ASSOCIATE);
    const partner = await login(PARTNER);
    const mp = await login(MP);
    const admin = await login(ADMIN);

    // Analyst records core scores (human, evaluator_kind='human').
    const keys = await paramKeys();
    const scoreRes = await post(`/api/decks/${id}/evaluate`, analyst, {
      scores: keys.map((key) => ({ key, value: 8 })),
      remarks: "Solid analyst pass",
    });
    expect(scoreRes.status).toBe(200);
    expect((await scoreRes.json()) as { weightedTotal: number }).toMatchObject({ weightedTotal: 8 });
    expect(await count("SELECT COUNT(*) AS n FROM scores WHERE deck_id = ? AND evaluator_kind = 'human'", id)).toBe(keys.length);

    // Analyst submits core scores → associate review.
    expect((await post(`/api/decks/${id}/transition`, analyst, { action: "submit_core_scores" })).status).toBe(200);
    expect(await statusOf(id)).toBe("associate_review");

    // Associate shortlists → partner review.
    expect((await post(`/api/decks/${id}/transition`, associate, { action: "shortlist_to_partner" })).status).toBe(200);
    expect(await statusOf(id)).toBe("partner_review");

    // Partner advances to the conviction call.
    expect((await post(`/api/decks/${id}/transition`, partner, { action: "advance_to_call" })).status).toBe(200);
    expect(await statusOf(id)).toBe("partner_call");

    // Partner sponsors to IC → investment DD (+ a partner-kind call is logged).
    expect((await post(`/api/decks/${id}/transition`, partner, { action: "sponsor_to_ic" })).status).toBe(200);
    expect(await statusOf(id)).toBe("investment_dd");
    expect(await count("SELECT COUNT(*) AS n FROM calls WHERE deck_id = ? AND kind = 'partner'", id)).toBe(1);

    // Partner (MP-delegated) approves DD → IC review (+ approved investment_dd row).
    expect((await post(`/api/decks/${id}/transition`, partner, { action: "mp_approve_dd" })).status).toBe(200);
    expect(await statusOf(id)).toBe("ic_review");
    expect(await count("SELECT COUNT(*) AS n FROM investment_dd WHERE deck_id = ? AND mp_approved = 1", id)).toBe(1);

    // IC members vote.
    expect((await post(`/api/decks/${id}/ic-vote`, await login(IC), { vote: "invest" })).status).toBe(200);
    expect((await post(`/api/decks/${id}/ic-vote`, partner, { vote: "invest" })).status).toBe(200);

    // Managing Partner closes the vote → MP decision.
    expect((await post(`/api/decks/${id}/transition`, mp, { action: "close_ic_vote" })).status).toBe(200);
    expect(await statusOf(id)).toBe("mp_decision");

    // MP decides to invest → alignment call.
    expect((await post(`/api/decks/${id}/transition`, mp, { action: "invest" })).status).toBe(200);
    expect(await statusOf(id)).toBe("alignment_call");

    // Partner issues the term sheet (captures valuation/ownership) → term sheet stage.
    expect(
      (
        await post(`/api/decks/${id}/transition`, partner, {
          action: "issue_term_sheet",
          valuation: "₹120 Cr",
          ownership: "12%",
        })
      ).status,
    ).toBe(200);
    expect(await statusOf(id)).toBe("term_sheet");
    const ts = await env.DB.prepare("SELECT valuation, ownership FROM term_sheets WHERE deck_id = ?")
      .bind(id)
      .first<{ valuation: string; ownership: string }>();
    expect(ts).toMatchObject({ valuation: "₹120 Cr", ownership: "12%" });
    expect(await count("SELECT COUNT(*) AS n FROM calls WHERE deck_id = ? AND kind = 'alignment'", id)).toBe(1);

    // Partner starts legal DD.
    expect((await post(`/api/decks/${id}/transition`, partner, { action: "start_legal_dd" })).status).toBe(200);
    expect(await statusOf(id)).toBe("legal_dd");
    expect(await count("SELECT COUNT(*) AS n FROM legal_dd WHERE deck_id = ?", id)).toBe(1);

    // Admin completes legal DD → onboard ready (+ a portfolio position).
    expect((await post(`/api/decks/${id}/transition`, admin, { action: "complete_legal_dd" })).status).toBe(200);
    expect(await statusOf(id)).toBe("onboard_ready");
    expect(await count("SELECT COUNT(*) AS n FROM portfolio WHERE deck_id = ?", id)).toBe(1);

    // Audit trail covers every stage transition.
    const events = (await (await get(`/api/decks/${id}/events`, mp)).json()) as {
      events: Array<{ action: string }>;
    };
    expect(events.events.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        "submit_core_scores",
        "shortlist_to_partner",
        "advance_to_call",
        "sponsor_to_ic",
        "mp_approve_dd",
        "close_ic_vote",
        "invest",
        "issue_term_sheet",
        "start_legal_dd",
        "complete_legal_dd",
      ]),
    );
  });
});

describe("VC branches: pass/archive and return-to-partner", () => {
  it("associate archives a deal that isn't shortlisted", async () => {
    const id = "vc_not_shortlisted";
    await seedVcDeck(id, "associate_review");
    const associate = await login(ASSOCIATE);
    expect((await post(`/api/decks/${id}/transition`, associate, { action: "not_shortlisted" })).status).toBe(200);
    expect(await statusOf(id)).toBe("archived");
  });

  it("MP passes at the final decision → archived", async () => {
    const id = "vc_mp_pass";
    await seedVcDeck(id, "mp_decision");
    const mp = await login(MP);
    expect((await post(`/api/decks/${id}/transition`, mp, { action: "pass" })).status).toBe(200);
    expect(await statusOf(id)).toBe("archived");
  });

  it("MP returns a deal to the partner for another look → partner_review", async () => {
    const id = "vc_return";
    await seedVcDeck(id, "mp_decision");
    const mp = await login(MP);
    expect((await post(`/api/decks/${id}/transition`, mp, { action: "return_to_partner" })).status).toBe(200);
    expect(await statusOf(id)).toBe("partner_review");
  });
});

describe("VC scoring prefill", () => {
  it("GET /my-scores returns the caller's saved human scores", async () => {
    const id = "vc_myscores";
    await seedVcDeck(id, "analyst_scoring");
    const analyst = await login(ANALYST);
    const keys = await paramKeys();
    await post(`/api/decks/${id}/evaluate`, analyst, {
      scores: keys.map((key) => ({ key, value: 6 })),
    });
    const body = (await (await get(`/api/decks/${id}/my-scores`, analyst)).json()) as {
      scores: Array<{ key: string; value: number }>;
    };
    expect(body.scores.length).toBe(keys.length);
    expect(body.scores.every((s) => s.value === 6)).toBe(true);
    // Another evaluator sees none of the analyst's scores (own-scores scoped).
    const partner = await login(PARTNER);
    const other = (await (await get(`/api/decks/${id}/my-scores`, partner)).json()) as {
      scores: unknown[];
    };
    expect(other.scores.length).toBe(0);
  });
});

describe("IC vote aggregation", () => {
  it("tallies per-member votes, picks a recommendation, and lets a member change their vote", async () => {
    const id = "vc_ic_agg";
    await seedVcDeck(id, "ic_review");
    const ic = await login(IC);
    const partner = await login(PARTNER);
    const mp = await login(MP);

    await post(`/api/decks/${id}/ic-vote`, ic, { vote: "invest", comment: "in" });
    await post(`/api/decks/${id}/ic-vote`, partner, { vote: "invest" });
    await post(`/api/decks/${id}/ic-vote`, mp, { vote: "hold" });

    let agg = (await (await get(`/api/decks/${id}/ic-votes`, mp)).json()) as {
      total: number;
      tally: Record<string, number>;
      recommendation: string;
      myVote: string | null;
    };
    expect(agg.total).toBe(3);
    expect(agg.tally).toMatchObject({ invest: 2, hold: 1, need_more_info: 0, pass: 0 });
    expect(agg.recommendation).toBe("invest");
    expect(agg.myVote).toBe("hold"); // mp's own ballot

    // The IC member changes their mind: invest → pass. Tally updates, no dup row.
    expect((await post(`/api/decks/${id}/ic-vote`, ic, { vote: "pass" })).status).toBe(200);
    agg = (await (await get(`/api/decks/${id}/ic-votes`, ic)).json()) as typeof agg;
    expect(agg.total).toBe(3);
    expect(agg.tally).toMatchObject({ invest: 1, hold: 1, pass: 1 });
    expect(agg.myVote).toBe("pass");
  });

  it("rejects an invalid vote value (400) and a vote outside ic_review (409)", async () => {
    const bad = "vc_ic_bad";
    await seedVcDeck(bad, "ic_review");
    const ic = await login(IC);
    expect((await post(`/api/decks/${bad}/ic-vote`, ic, { vote: "maybe" })).status).toBe(400);

    const early = "vc_ic_early";
    await seedVcDeck(early, "partner_review");
    expect((await post(`/api/decks/${early}/ic-vote`, ic, { vote: "invest" })).status).toBe(409);
  });
});

describe("VC per-stage authorization", () => {
  it("an analyst cannot sponsor a deal to IC (403)", async () => {
    const id = "vc_authz_analyst";
    await seedVcDeck(id, "partner_call");
    const analyst = await login(ANALYST);
    expect((await post(`/api/decks/${id}/transition`, analyst, { action: "sponsor_to_ic" })).status).toBe(403);
    expect(await statusOf(id)).toBe("partner_call");
  });

  it("an IC member cannot close the IC vote — MP only (403)", async () => {
    const id = "vc_authz_close";
    await seedVcDeck(id, "ic_review");
    const ic = await login(IC);
    expect((await post(`/api/decks/${id}/transition`, ic, { action: "close_ic_vote" })).status).toBe(403);
  });

  it("a partner cannot render the final MP invest decision (403)", async () => {
    const id = "vc_authz_mp";
    await seedVcDeck(id, "mp_decision");
    const partner = await login(PARTNER);
    expect((await post(`/api/decks/${id}/transition`, partner, { action: "invest" })).status).toBe(403);
  });

  it("an analyst cannot cast an IC vote (403)", async () => {
    const id = "vc_authz_vote";
    await seedVcDeck(id, "ic_review");
    const analyst = await login(ANALYST);
    expect((await post(`/api/decks/${id}/ic-vote`, analyst, { vote: "invest" })).status).toBe(403);
  });

  it("a non-committee VC user cannot read the confidential IC ballots (403)", async () => {
    const id = "vc_authz_ballots";
    await seedVcDeck(id, "ic_review");
    const analyst = await login(ANALYST);
    expect((await get(`/api/decks/${id}/ic-votes`, analyst)).status).toBe(403);
  });

  it("a VC evaluator cannot score a deal past the scoring stages (409)", async () => {
    const id = "vc_authz_latescore";
    await seedVcDeck(id, "ic_review");
    const analyst = await login(ANALYST);
    const keys = await paramKeys();
    const res = await post(`/api/decks/${id}/evaluate`, analyst, {
      scores: keys.map((key) => ({ key, value: 7 })),
    });
    expect(res.status).toBe(409);
  });

  it("an unknown action from a VC stage is a 409", async () => {
    const id = "vc_authz_unknown";
    await seedVcDeck(id, "partner_review");
    const mp = await login(MP);
    expect((await post(`/api/decks/${id}/transition`, mp, { action: "nope" })).status).toBe(409);
  });
});
