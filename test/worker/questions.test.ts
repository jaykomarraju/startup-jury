import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

/**
 * W2-C — the Clarification question bank (`/api/questions`) and the
 * clarification letter it produces.
 *
 * `migrations/0028_question_bank.sql` seeds 68 questions per edition, keyed to
 * `parameters.id`: five for each of the thirteen scored areas, eight for
 * Climate Impact & Integrity. These tests cover the four bank mutations, the
 * authZ around them, and the producer that draws the bank into a founder
 * query.
 */

const BASE = "https://example.com";

// Seeded logins (migrations/0002_seed.sql, 0015_roles_users.sql).
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const SUPERUSER = "priya.sharma@demo.startupjury.ai"; // incubator superuser
const PA = "sunita.rao@demo.startupjury.ai"; // program_associate — can query
const JURY = "rajesh.kumar@demo.startupjury.ai"; // jury — can do neither
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai"; // vc admin

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

interface AreaView {
  parameterId: string;
  key: string;
  name: string;
  questions: { id: string; seq: number; text: string }[];
}

async function bank(cookie: string): Promise<AreaView[]> {
  const res = await get("/api/questions", cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { areas: AreaView[] }).areas;
}

const areaOf = (areas: AreaView[], key: string) => areas.find((a) => a.key === key)!;

describe("question bank — the seeded shape", () => {
  it("is thirteen areas and 68 questions, five each and eight for Climate Impact", async () => {
    const areas = await bank(await login(ADMIN));
    expect(areas).toHaveLength(13);
    expect(areas.reduce((n, a) => n + a.questions.length, 0)).toBe(68);
    expect(areaOf(areas, "climate_impact").questions).toHaveLength(8);
    for (const area of areas) {
      if (area.key === "climate_impact") continue;
      expect(area.questions, area.key).toHaveLength(5);
    }
  });

  it("orders each area by seq and carries the prototype's own wording", async () => {
    const areas = await bank(await login(ADMIN));
    const problem = areaOf(areas, "problem_market_clarity");
    expect(problem.name).toBe("Problem & Market Clarity");
    expect(problem.questions.map((q) => q.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(problem.questions[0].text).toBe("Who is the primary customer facing this problem?");
  });

  it("is scoped to the caller's edition", async () => {
    const inc = await bank(await login(ADMIN));
    const vc = await bank(await login(VC_ADMIN));
    expect(inc[0].parameterId.startsWith("inc_")).toBe(true);
    expect(vc[0].parameterId.startsWith("vc_")).toBe(true);
    expect(vc.reduce((n, a) => n + a.questions.length, 0)).toBe(68);
  });
});

describe("question bank — add, edit, delete, reorder", () => {
  it("adds a question to the end of its area and grows the count", async () => {
    const admin = await login(ADMIN);
    const before = areaOf(await bank(admin), "gtm_strategy");
    const res = await req("POST", "/api/questions", admin, {
      parameterId: before.parameterId,
      text: "  Which channel   converts fastest today?  ",
    });
    expect(res.status).toBe(201);
    const { question } = (await res.json()) as {
      question: { id: string; seq: number };
    };

    const after = areaOf(await bank(admin), "gtm_strategy");
    expect(after.questions).toHaveLength(before.questions.length + 1);
    // Whitespace is normalised on the way in.
    expect(after.questions.at(-1)!.text).toBe("Which channel converts fastest today?");
    expect(after.questions.at(-1)!.id).toBe(question.id);
  });

  it("rejects an empty question and an unknown area", async () => {
    const admin = await login(ADMIN);
    const areas = await bank(admin);
    expect(
      (
        await req("POST", "/api/questions", admin, {
          parameterId: areaOf(areas, "market_size").parameterId,
          text: "   ",
        })
      ).status,
    ).toBe(400);
    // A VC parameter is not this admin's to write to.
    expect(
      (
        await req("POST", "/api/questions", admin, {
          parameterId: "vc_market_size",
          text: "x",
        })
      ).status,
    ).toBe(400);
  });

  it("edits one question in place", async () => {
    const admin = await login(ADMIN);
    const target = areaOf(await bank(admin), "team_execution").questions[0];
    const res = await req("PUT", `/api/questions/${target.id}`, admin, {
      text: "Who on the team has shipped this before?",
    });
    expect(res.status).toBe(200);

    const after = areaOf(await bank(admin), "team_execution").questions[0];
    expect(after.id).toBe(target.id);
    expect(after.text).toBe("Who on the team has shipped this before?");
    expect(after.seq).toBe(target.seq);
  });

  it("404s on a question from another edition", async () => {
    const admin = await login(ADMIN);
    const vcQuestion = areaOf(await bank(await login(VC_ADMIN)), "market_size").questions[0];
    expect(
      (
        await req("PUT", `/api/questions/${vcQuestion.id}`, admin, {
          text: "no",
        })
      ).status,
    ).toBe(404);
    expect((await req("DELETE", `/api/questions/${vcQuestion.id}`, admin)).status).toBe(404);
  });

  it("deletes softly — the row survives so a sent query still reads back", async () => {
    const admin = await login(ADMIN);
    const before = areaOf(await bank(admin), "business_risks");
    const doomed = before.questions[1];

    expect((await req("DELETE", `/api/questions/${doomed.id}`, admin)).status).toBe(200);

    const after = areaOf(await bank(admin), "business_risks");
    expect(after.questions.map((q) => q.id)).not.toContain(doomed.id);
    expect(after.questions).toHaveLength(before.questions.length - 1);

    const row = await env.DB.prepare("SELECT text, active FROM question_bank WHERE id = ?")
      .bind(doomed.id)
      .first<{ text: string; active: number }>();
    expect(row).not.toBeNull();
    expect(row!.active).toBe(0);
    expect(row!.text).toBe(doomed.text);
  });

  it("reorder rewrites seq densely from 1", async () => {
    const admin = await login(ADMIN);
    const before = areaOf(await bank(admin), "competitive_landscape");
    const ids = before.questions.map((q) => q.id);
    const moved = [ids[2], ...ids.filter((_, i) => i !== 2)];

    expect(
      (
        await req("PUT", "/api/questions/reorder", admin, {
          parameterId: before.parameterId,
          ids: moved,
        })
      ).status,
    ).toBe(200);

    const after = areaOf(await bank(admin), "competitive_landscape");
    expect(after.questions.map((q) => q.id)).toEqual(moved);
    expect(after.questions.map((q) => q.seq)).toEqual([1, 2, 3, 4, 5]);
    // Q3 is now the question that was Q1.
    expect(after.questions[0].text).toBe(before.questions[2].text);
  });

  it("refuses a partial or padded reorder rather than leaving seq ambiguous", async () => {
    const admin = await login(ADMIN);
    const area = areaOf(await bank(admin), "storytelling");
    const ids = area.questions.map((q) => q.id);
    for (const bad of [ids.slice(1), [...ids, ids[0]], [...ids.slice(1), "qb_not_real"]]) {
      const res = await req("PUT", "/api/questions/reorder", admin, {
        parameterId: area.parameterId,
        ids: bad,
      });
      expect(res.status).toBe(400);
    }
    // Untouched.
    expect(areaOf(await bank(admin), "storytelling").questions.map((q) => q.id)).toEqual(ids);
  });

  it("lets a superuser do the same", async () => {
    const su = await login(SUPERUSER);
    const area = areaOf(await bank(su), "product_technology");
    expect(
      (
        await req("PUT", `/api/questions/${area.questions[0].id}`, su, {
          text: "Superuser edit?",
        })
      ).status,
    ).toBe(200);
  });
});

describe("question bank — authZ", () => {
  it("a non-admin cannot read or write the bank", async () => {
    for (const email of [PA, JURY]) {
      const cookie = await login(email);
      expect((await get("/api/questions", cookie)).status, email).toBe(403);
      const area = "inc_market_size";
      for (const [method, path, body] of [
        ["POST", "/api/questions", { parameterId: area, text: "x" }],
        ["PUT", "/api/questions/qb_inc_market_size_1", { text: "x" }],
        ["DELETE", "/api/questions/qb_inc_market_size_1", undefined],
        ["PUT", "/api/questions/reorder", { parameterId: area, ids: [] }],
      ] as const) {
        expect((await req(method, path, cookie, body)).status, `${email} ${method} ${path}`).toBe(
          403,
        );
      }
    }
  });

  it("is closed to anyone signed out", async () => {
    expect((await get("/api/questions", "")).status).toBe(401);
  });
});

describe("the producer — GET /api/questions/draft/:deckId", () => {
  /** A deck with at least one AI score under the edition's mediocre threshold. */
  async function weakDeck(): Promise<{
    id: string;
    parameterId: string;
    name: string;
  }> {
    const row = await env.DB.prepare(
      "SELECT d.id AS id, d.name AS name, s.parameter_id AS parameter_id FROM decks d " +
        "JOIN scores s ON s.deck_id = d.id AND s.evaluator_kind = 'ai' " +
        "JOIN parameters p ON p.id = s.parameter_id AND p.informational = 0 " +
        "WHERE d.edition = 'incubator' " +
        "  AND s.value < (SELECT o.threshold_mediocre FROM org_settings o WHERE o.edition = 'incubator') " +
        "LIMIT 1",
    ).first<{ id: string; name: string; parameter_id: string }>();
    expect(row, "no seeded incubator deck has a weak AI area").not.toBeNull();
    return { id: row!.id, name: row!.name, parameterId: row!.parameter_id };
  }

  interface Draft {
    deckName: string;
    autoClarification: boolean;
    triggered: boolean;
    areas: { kind: string; label: string }[];
    questions: { area: string; questions: string[] }[];
    message: string;
  }

  it("draws the weak areas' real questions into the letter", async () => {
    const admin = await login(ADMIN);
    const deck = await weakDeck();
    const areas = await bank(admin);
    const weak = areas.find((a) => a.parameterId === deck.parameterId)!;

    const res = await get(`/api/questions/draft/${deck.id}`, admin);
    expect(res.status).toBe(200);
    const draft = (await res.json()) as Draft;

    expect(draft.deckName).toBe(deck.name);
    expect(draft.questions.map((q) => q.area)).toContain(weak.name);
    const asked = draft.questions.find((q) => q.area === weak.name)!;
    expect(asked.questions).toEqual(weak.questions.map((q) => q.text));
    // The letter asks the question rather than naming the area (F0030, F0096).
    expect(draft.message).toContain(weak.questions[0].text);
    expect(draft.message).toContain(`${weak.name} (weak signal)`);
    expect(draft.message).not.toContain(`• ${weak.name} (weak signal)`);
  });

  it("follows an edit — the reworded question is what the founder is asked", async () => {
    const admin = await login(ADMIN);
    const deck = await weakDeck();
    const weak = (await bank(admin)).find((a) => a.parameterId === deck.parameterId)!;
    const edited = "Which single metric best proves this is working?";

    expect(
      (
        await req("PUT", `/api/questions/${weak.questions[0].id}`, admin, {
          text: edited,
        })
      ).status,
    ).toBe(200);

    const draft = (await (await get(`/api/questions/draft/${deck.id}`, admin)).json()) as Draft;
    expect(draft.message).toContain(edited);
    expect(draft.message).not.toContain(weak.questions[0].text);
  });

  it("honours the auto-clarification toggle for the automatic decision only", async () => {
    const admin = await login(ADMIN);
    const deck = await weakDeck();

    const on = (await (await get(`/api/questions/draft/${deck.id}`, admin)).json()) as Draft;
    expect(on.autoClarification).toBe(true);
    expect(on.triggered).toBe(true);

    await env.DB.prepare(
      "UPDATE org_scoring_settings SET auto_clarification = 0 WHERE edition = 'incubator'",
    ).run();
    const off = (await (await get(`/api/questions/draft/${deck.id}`, admin)).json()) as Draft;
    expect(off.autoClarification).toBe(false);
    expect(off.triggered).toBe(false);
    // A human who opened the Query screen still gets a draft to send by hand.
    expect(off.message).toBe(on.message);

    await env.DB.prepare(
      "UPDATE org_scoring_settings SET auto_clarification = 1 WHERE edition = 'incubator'",
    ).run();
  });

  it("stops asking about an area whose questions were all deleted", async () => {
    const admin = await login(ADMIN);
    const deck = await weakDeck();
    const weak = (await bank(admin)).find((a) => a.parameterId === deck.parameterId)!;
    for (const q of weak.questions) {
      expect((await req("DELETE", `/api/questions/${q.id}`, admin)).status).toBe(200);
    }

    const draft = (await (await get(`/api/questions/draft/${deck.id}`, admin)).json()) as Draft;
    expect(draft.questions.map((q) => q.area)).not.toContain(weak.name);
    // It falls back to naming the area, exactly as the pre-bank letter did.
    expect(draft.message).toContain(`• ${weak.name} (weak signal)`);
  });

  it("is open to the roles that raise queries and closed to the jury", async () => {
    const deck = await weakDeck();
    expect((await get(`/api/questions/draft/${deck.id}`, await login(PA))).status).toBe(200);
    expect((await get(`/api/questions/draft/${deck.id}`, await login(JURY))).status).toBe(403);
  });

  it("404s on a deck from another edition", async () => {
    const deck = await weakDeck();
    expect((await get(`/api/questions/draft/${deck.id}`, await login(VC_ADMIN))).status).toBe(404);
  });
});
