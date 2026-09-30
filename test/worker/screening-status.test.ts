import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { evaluateDeck, type RawEvaluation } from "../../src/server/ai/evaluate";
import { runNoResponseSweep } from "../../src/server/scheduled";
import { screeningStatus, type ScreeningDeck } from "../../src/shared/deckStats";
import { QUERY_RESPONSE_WORKING_DAYS } from "../../src/shared/queries";
import type { Env } from "../../src/server/types";

/**
 * S2-SERVER — the four server-side halves of the client's screening flow
 * ("Deck Screening Logic: Status & Action Flow", transcribed at
 * `docs/spec_screening_flow.md`).
 *
 * Each `describe` below is one of them:
 *
 *   1. **The gate is a setting, and "at or above" wins.** His third check is
 *      "Rating >= threshold?" and until migration 0082 that question had no data
 *      source at all — the gate was `const GATE = 5` in `ai/evaluate.ts`. The
 *      constant is gone, not defaulted: a fallback beside a setting is how this
 *      product came to have three numbers that answer to "the threshold".
 *   2. **A sub-gate deck waits.** It used to be moved straight to `rejected` by
 *      the evaluator, which made two of his own statuses unreachable.
 *   3. **The `send_to_assign` marker.** His Send-to-Assign row needs a record of
 *      the click; his row 12 Foul forbids reaching the `assigned` stage without
 *      a real evaluator. A non-transition `pipeline_events` row satisfies both.
 *   4. **Row 3 — routing happens when the operator clicks.** His reason, kept
 *      verbatim in the route: a deck with incomplete contact details cannot be
 *      emailed, for want of contact details.
 *
 * Plus **his open item**: queried, never answered, archived with the reason
 * "no response" — the one exemption from his row 7 latch.
 *
 * The assertions run against the REAL response wherever there is one, and hand
 * it to `screeningStatus` (S0-VOCAB's derivation) rather than to a hand-built
 * fixture — the loop is only closed if the fields the server serves are the
 * fields the status function reads.
 *
 * NB (worker-test gotcha, stated at the top of `automation.test.ts`): storage is
 * isolated per FILE, not per test, so every fixture below has a unique id.
 */

const BASE = "https://example.com";
const SUPER = "priya.sharma@demo.startupjury.ai";
const ADMIN = "nisha.kapoor@demo.startupjury.ai";
const PM = "raj.kumar@demo.startupjury.ai";
const JURY = "rajesh.kumar@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function seedDeck(id: string, opts: { status?: string; complete?: boolean } = {}): Promise<void> {
  const { status = "pending_ai", complete = true } = opts;
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, stage, city, founder, founder_email, founder_phone, " +
      "status, r2_key, uploaded_by, complete) " +
      "VALUES (?, 'incubator', ?, 'Seed', 'Pune', 'Ada Founder', 'ada@testco.example', '+91 90000 00000', ?, ?, 'inc_pa', ?)",
  )
    .bind(id, `Deck ${id}`, status, `decks/${id}.pdf`, complete ? 1 : 0)
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

/** Run the AI path with a stubbed model verdict at a chosen flat score. */
async function evaluate(id: string, score: number, complete = true) {
  const keys = await paramKeys();
  return evaluateDeck(env as Env, id, {
    callModel: async (): Promise<RawEvaluation> => ({
      complete,
      founder: "Ada Founder",
      founder_email: "ada@testco.example",
      founder_phone: "+91 90000 00000",
      city: "Pune",
      sector: "B2B SaaS",
      scores: keys.map((key) => ({ key, value: score })),
    }),
  });
}

function setGate(value: number) {
  return env.DB.prepare("UPDATE org_scoring_settings SET ai_gate_threshold = ? WHERE edition = 'incubator'")
    .bind(value)
    .run();
}

interface Row {
  id: string;
  name: string;
  statusId?: string;
  aiScore?: number;
  aiComplete?: boolean;
  complete?: boolean;
  missingFields?: string[];
  queried?: boolean;
  sendToAssignAt?: string;
  lastQueryAt?: string;
  lastQueryAnswered?: boolean;
}

async function deck(id: string, cookie: string): Promise<Row> {
  const res = await SELF.fetch(`${BASE}/api/decks/${id}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { deck: Row }).deck;
}

async function listNames(cookie: string, which?: "assign" | "query"): Promise<string[]> {
  const res = await SELF.fetch(`${BASE}/api/decks${which ? `?list=${which}` : ""}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { decks: Row[] }).decks.map((d) => d.name).sort();
}

/** The gate the org is configured with, so the status agrees with the server. */
let GATE = 5;
beforeAll(async () => {
  const row = await env.DB.prepare(
    "SELECT ai_gate_threshold AS g FROM org_scoring_settings WHERE edition = 'incubator'",
  ).first<{ g: number }>();
  GATE = row!.g;
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · The gate is the org's number, and "at or above" wins
// ═══════════════════════════════════════════════════════════════════════════

describe("the AI gate is a setting (0082), not a constant", () => {
  it("ships at 5.0 on both editions — the constant it replaced, so no org changes verdict", async () => {
    const rows = (
      await env.DB.prepare("SELECT edition, ai_gate_threshold AS g FROM org_scoring_settings").all<{
        edition: string;
        g: number;
      }>()
    ).results;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.g).toBe(5);
  });

  it("GET /api/config/scoring serves it, so the console can show what it enforces", async () => {
    const cookie = await login(SUPER);
    const res = await SELF.fetch(`${BASE}/api/config/scoring`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scoring: Record<string, unknown> };
    expect(body.scoring.aiGateThreshold).toBe(5);
    // Named apart from the SHORTLIST floor on purpose: two numbers on one 0–10
    // scale answering different questions. `routes/decks.ts` records a past
    // confusion between them, and this is the line that keeps them two.
    expect(body.scoring.shortlistThreshold).toBe(7);
  });

  it("PUT persists a new gate and refuses one off the scale with its OWN error code", async () => {
    const cookie = await login(ADMIN);
    const put = (patch: Record<string, unknown>) =>
      SELF.fetch(`${BASE}/api/config/scoring-framework`, {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(patch),
      });

    const ok = await put({ aiGateThreshold: 6.5 });
    expect(ok.status).toBe(200);
    const after = await env.DB.prepare(
      "SELECT ai_gate_threshold AS g, shortlist_threshold AS s FROM org_scoring_settings WHERE edition = 'incubator'",
    ).first<{ g: number; s: number }>();
    expect(after!.g).toBe(6.5);
    // The neighbour did not move — a shared UPDATE is where two settings become
    // one by accident.
    expect(after!.s).toBe(7);

    const bad = await put({ aiGateThreshold: 11 });
    expect(bad.status).toBe(400);
    // Its own code, not `invalid_shortlist_threshold`: an admin who mistyped one
    // must not be sent to look at the other.
    expect((await bad.json()) as { error: string }).toEqual({ error: "invalid_ai_gate_threshold" });

    await setGate(5);
  });

  it("a deck scoring EXACTLY the gate passes — his words are 'at or above' (C13)", async () => {
    await setGate(5);
    await seedDeck("sc_exact");
    const r = await evaluate("sc_exact", 5);
    // One character, and the whole of C13: this was `total > GATE`, from a
    // different diagram, so a 5.0 deck was Complete under his spec and Rejected
    // under ours.
    expect(r.weightedTotal).toBe(5);
    expect(r.gatePassed).toBe(true);
    expect(r.status).toBe("ai_evaluated");
  });

  it("the org's own number is what is enforced — the same deck fails a stricter gate", async () => {
    // Without this the setting could be read and ignored and every other test
    // in this file would still pass.
    await setGate(7);
    await seedDeck("sc_strict");
    const r = await evaluate("sc_strict", 6);
    expect(r.gatePassed).toBe(false);

    await setGate(5);
    await seedDeck("sc_lenient");
    expect((await evaluate("sc_lenient", 6)).gatePassed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · A below-threshold deck WAITS — which is what makes I4 reachable
// ═══════════════════════════════════════════════════════════════════════════

describe("a sub-gate deck waits at ai_evaluated instead of being rejected", () => {
  it("lands at ai_evaluated with its low score, and reads 'Below threshold'", async () => {
    await setGate(5);
    await seedDeck("sc_below");
    const r = await evaluate("sc_below", 3);
    expect(r.gatePassed).toBe(false);
    expect(r.status).toBe("ai_evaluated");

    const cookie = await login(SUPER);
    const view = await deck("sc_below", cookie);
    expect(view.statusId).toBe("ai_evaluated");
    expect(view.aiComplete).toBe(true);
    expect(view.missingFields ?? []).toEqual([]);
    expect(view.aiScore).toBe(3);

    // The point of the behaviour change, asserted through the derivation the
    // Dashboard renders: I4 (`D ∧ C ∧ ¬R`). Measured before this change, NO
    // deck could ever be in this state — every sub-gate deck had already been
    // moved to `rejected` by the evaluator, so the status his matrix draws a
    // Reject button on described nothing.
    expect(screeningStatus(view as ScreeningDeck, { gate: GATE })).toBe("belowThreshold");
  });

  it("and Reject is offered ON it — `reject_ai_gate`'s label is finally true", async () => {
    await setGate(5);
    await seedDeck("sc_reject");
    await evaluate("sc_reject", 3);
    const cookie = await login(SUPER);

    const view = await deck("sc_reject", cookie);
    const actions = ((view as unknown as { actions?: { action: string }[] }).actions ?? []).map((a) => a.action);
    expect(actions).toContain("reject_ai_gate");

    const res = await SELF.fetch(`${BASE}/api/decks/sc_reject/transition`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "reject_ai_gate" }),
    });
    expect(res.status).toBe(200);

    // I5. And his Rejected row offers Archive, which `rejected -> archived`
    // already serves.
    const rejected = await deck("sc_reject", cookie);
    expect(rejected.statusId).toBe("rejected");
    expect(screeningStatus(rejected as ScreeningDeck, { gate: GATE })).toBe("rejected");
  });

  it("the verdict is still recorded, so nothing forgets the gate was missed", async () => {
    await setGate(5);
    await seedDeck("sc_verdict");
    await evaluate("sc_verdict", 2);
    const row = await env.DB.prepare(
      "SELECT verdict FROM evaluations WHERE deck_id = ? AND evaluator_id IS NULL",
    )
      .bind("sc_verdict")
      .first<{ verdict: string }>();
    expect(row!.verdict).toBe("below_gate");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · The send_to_assign marker
// ═══════════════════════════════════════════════════════════════════════════

describe("Send to Assign is recorded as a marker, never as the assigned stage", () => {
  const markers = (id: string) =>
    env.DB.prepare(
      "SELECT from_stage, to_stage, action, actor_id FROM pipeline_events WHERE deck_id = ? AND action = 'send_to_assign'",
    )
      .bind(id)
      .all<{ from_stage: string | null; to_stage: string; action: string; actor_id: string | null }>();

  it("writes one non-transition event and serves it as sendToAssignAt", async () => {
    await setGate(5);
    await seedDeck("sc_send");
    await evaluate("sc_send", 8);
    const cookie = await login(SUPER);

    const before = await deck("sc_send", cookie);
    expect(before.sendToAssignAt).toBeUndefined();
    // I6 — the one status his matrix lets Send to Assign fire from.
    expect(screeningStatus(before as ScreeningDeck, { gate: GATE })).toBe("complete");

    const res = await SELF.fetch(`${BASE}/api/decks/sc_send/send-to-assign`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deck: Row };
    expect(body.ok).toBe(true);
    expect(body.deck.sendToAssignAt).toEqual(expect.any(String));

    const rows = (await markers("sc_send")).results;
    expect(rows).toHaveLength(1);
    // An edit is not a transition and neither is this: `from_stage === to_stage`
    // is the same shape `edit_contact` uses, and it is what keeps a marker out
    // of the exit-reason columns.
    expect(rows[0].from_stage).toBe("ai_evaluated");
    expect(rows[0].to_stage).toBe("ai_evaluated");
    expect(rows[0].actor_id).toBeTruthy();
  });

  it("does NOT move the stage and does NOT claim an evaluator — his row 12 Foul", async () => {
    await setGate(5);
    await seedDeck("sc_send2");
    await evaluate("sc_send2", 8);
    const cookie = await login(SUPER);
    await SELF.fetch(`${BASE}/api/decks/sc_send2/send-to-assign`, { method: "POST", headers: { cookie } });

    const raw = await env.DB.prepare("SELECT status, assigned_to FROM decks WHERE id = ?")
      .bind("sc_send2")
      .first<{ status: string; assigned_to: string | null }>();
    // The obvious implementation is the `assigned` stage, and it is the one his
    // row 12 forbids: `POST /decks/:id/transition` will move a deck there with
    // `assigned_to` still NULL — "startups without any decks, assigned to Jury".
    expect(raw).toEqual({ status: "ai_evaluated", assigned_to: null });

    // The deck has nonetheless LATCHED, which is what his row 7 needs.
    const view = await deck("sc_send2", cookie);
    expect(screeningStatus(view as ScreeningDeck, { gate: GATE })).toBe("assigned");
  });

  it("does not disturb the exit-reason columns, which select on to_stage", async () => {
    await setGate(5);
    await seedDeck("sc_send3");
    await evaluate("sc_send3", 8);
    const cookie = await login(SUPER);
    await SELF.fetch(`${BASE}/api/decks/sc_send3/send-to-assign`, { method: "POST", headers: { cookie } });
    const view = (await deck("sc_send3", cookie)) as Row & { exitAt?: string; exitAction?: string };
    expect(view.exitAt).toBeUndefined();
    expect(view.exitAction).toBeUndefined();
  });

  it("a second click is a second fact, not an error", async () => {
    await setGate(5);
    await seedDeck("sc_twice");
    await evaluate("sc_twice", 8);
    const cookie = await login(SUPER);
    for (let click = 0; click < 2; click += 1) {
      const res = await SELF.fetch(`${BASE}/api/decks/sc_twice/send-to-assign`, { method: "POST", headers: { cookie } });
      expect(res.status).toBe(200);
    }
    // Both clicks are in the history; the latch reads MAX(created_at), so it is
    // unaffected by there being two.
    expect((await markers("sc_twice")).results).toHaveLength(2);
    expect((await deck("sc_twice", cookie)).sendToAssignAt).toEqual(expect.any(String));
  });

  it("is role-gated to the roles that may assign, and 404s an unknown deck", async () => {
    const cookie = await login(SUPER);
    expect(
      (await SELF.fetch(`${BASE}/api/decks/sc_nope/send-to-assign`, { method: "POST", headers: { cookie } })).status,
    ).toBe(404);

    await setGate(5);
    await seedDeck("sc_gate_role");
    await evaluate("sc_gate_role", 8);

    // The PM is the decision maker and may send.
    const pm = await login(PM);
    expect(
      (await SELF.fetch(`${BASE}/api/decks/sc_gate_role/send-to-assign`, { method: "POST", headers: { cookie: pm } }))
        .status,
    ).toBe(200);

    // NEGATIVE CONTROL. A juror scores decks; putting one in front of the jury
    // is not theirs to do, and role-boundary leaks in this product have
    // recurred often enough to be worth one assertion per new route.
    const jury = await login(JURY);
    expect(
      (await SELF.fetch(`${BASE}/api/decks/sc_gate_role/send-to-assign`, { method: "POST", headers: { cookie: jury } }))
        .status,
    ).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Row 3 — the automatic partition is gone, server side
// ═══════════════════════════════════════════════════════════════════════════

describe("row 3 — ?list=query means QUERIED, not 'derived as incomplete'", () => {
  it("an incomplete deck nobody sent is on NEITHER list, and still in the whole table", async () => {
    const cookie = await login(SUPER);
    await seedDeck("sc_row3", { complete: false });
    await evaluate("sc_row3", 8, false);

    const view = await deck("sc_row3", cookie);
    expect(view.statusId).toBe("incomplete");
    expect(view.queried).toBe(false);

    // His stated reason, and it is a live defect the derivation kept armed:
    // `POST /decks/:id/queries` falls back to a placeholder address when the
    // deck has no founder email, so a deck listed for want of contact details
    // could be emailed to nobody. Nothing arms that automatically any more.
    expect(await listNames(cookie, "query")).not.toContain("Deck sc_row3");
    expect(await listNames(cookie, "assign")).not.toContain("Deck sc_row3");
    expect(await listNames(cookie)).toContain("Deck sc_row3");
  });

  it("…and reaches the Query list once a query is actually raised", async () => {
    const cookie = await login(SUPER);
    await seedDeck("sc_row3b", { complete: false });
    await evaluate("sc_row3b", 8, false);
    expect(await listNames(cookie, "query")).not.toContain("Deck sc_row3b");

    const res = await SELF.fetch(`${BASE}/api/decks/sc_row3b/queries`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ questions: "Please send your phone number." }),
    });
    expect(res.status).toBe(200);

    // Membership is now the RECORDED ACTION, which is the whole of row 3.
    expect(await listNames(cookie, "query")).toContain("Deck sc_row3b");
    const view = await deck("sc_row3b", cookie);
    expect(view.queried).toBe(true);
    expect(view.lastQueryAt).toEqual(expect.any(String));
    expect(view.lastQueryAnswered).toBe(false);
  });

  it("the ASSIGN arm is untouched — a complete evaluated deck is still on it", async () => {
    await setGate(5);
    const cookie = await login(SUPER);
    await seedDeck("sc_row3c");
    await evaluate("sc_row3c", 8);
    // Row 3 deletes the CONCLUSION that being off Assign puts a deck on Query.
    // It does not touch "only the ones marked complete go to Assign", which is
    // the half of his sentence that survives whole.
    expect(await listNames(cookie, "assign")).toContain("Deck sc_row3c");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4b · Send to Query is recorded too — row 3's other half
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Row 3 makes Query membership a recorded action, and BEFORE this route there
 * was nothing to record it with: the only writer of a `queries` row is the
 * compose-and-send on the Query screen, and the deck cannot reach that screen
 * until a `queries` row exists. Send to Query would have navigated to a list the
 * deck is not on, and `?list=query` would have been a screen an operator could
 * never populate.
 *
 * The prototype answers it and the build had lost it: `upSendToQuery` puts the
 * deck on the list as **Pending** before any email goes out, which is why
 * `queryStatusOf` has a Pending status at all.
 */
describe("Send to Query records the send, as a pending clarification", () => {
  const queries = (id: string) =>
    env.DB.prepare("SELECT questions, email_status, founder_response FROM queries WHERE deck_id = ?")
      .bind(id)
      .all<{ questions: string; email_status: string; founder_response: string | null }>();

  it("puts the deck on the Query list, and mails NOTHING", async () => {
    const cookie = await login(SUPER);
    await seedDeck("sc_stq", { complete: false });
    await evaluate("sc_stq", 8, false);
    expect(await listNames(cookie, "query")).not.toContain("Deck sc_stq");

    const outboxBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM email_outbox").first<{ n: number }>();

    const res = await SELF.fetch(`${BASE}/api/decks/sc_stq/send-to-query`, { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()) as { raised: boolean }).toMatchObject({ ok: true, raised: true });

    expect(await listNames(cookie, "query")).toContain("Deck sc_stq");
    const rows = (await queries("sc_stq")).results;
    expect(rows).toHaveLength(1);
    // Pending, and with no question yet — the operator composes on the screen
    // the deck has just joined.
    expect(rows[0]).toMatchObject({ questions: "", email_status: "pending", founder_response: null });

    // NOTHING WAS SENT, and that is the guard that matters. His own stated
    // reason for row 3 is that a deck with incomplete contact details cannot be
    // emailed, and `POST /decks/:id/queries` falls back to a placeholder
    // address when the deck has no founder email. A click that both listed AND
    // mailed would reintroduce exactly the send he complained about.
    const outboxAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM email_outbox").first<{ n: number }>();
    expect(outboxAfter!.n).toBe(outboxBefore!.n);
  });

  it("reads as the 'Incomplete, Queried' sink once sent", async () => {
    const cookie = await login(SUPER);
    await seedDeck("sc_stq_sink", { complete: false });
    await evaluate("sc_stq_sink", 8, false);
    await SELF.fetch(`${BASE}/api/decks/sc_stq_sink/send-to-query`, { method: "POST", headers: { cookie } });

    const view = await deck("sc_stq_sink", cookie);
    expect(view.queried).toBe(true);
    expect(view.lastQueryAt).toEqual(expect.any(String));
    expect(view.lastQueryAnswered).toBe(false);
    expect(screeningStatus(view as ScreeningDeck, { gate: GATE })).toBe("queried");
  });

  it("does not stack a second pending row on a query nobody has answered", async () => {
    const cookie = await login(SUPER);
    await seedDeck("sc_stq_twice", { complete: false });
    await evaluate("sc_stq_twice", 8, false);
    const first = await SELF.fetch(`${BASE}/api/decks/sc_stq_twice/send-to-query`, { method: "POST", headers: { cookie } });
    expect((await first.json()) as { raised: boolean }).toMatchObject({ raised: true });

    const second = await SELF.fetch(`${BASE}/api/decks/sc_stq_twice/send-to-query`, { method: "POST", headers: { cookie } });
    expect(second.status).toBe(200);
    // `raised: false` so the screen can say "already queried" instead of
    // claiming it just did something — and, more importantly, a second row
    // would push the no-response clock back every time somebody clicked.
    expect((await second.json()) as { raised: boolean }).toMatchObject({ raised: false });
    expect((await queries("sc_stq_twice")).results).toHaveLength(1);
  });

  it("and the operator's real letter sends from the Query screen as before", async () => {
    const cookie = await login(SUPER);
    await seedDeck("sc_stq_send", { complete: false });
    await evaluate("sc_stq_send", 8, false);
    await SELF.fetch(`${BASE}/api/decks/sc_stq_send/send-to-query`, { method: "POST", headers: { cookie } });

    const res = await SELF.fetch(`${BASE}/api/decks/sc_stq_send/queries`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ questions: "Please send your phone number." }),
    });
    expect(res.status).toBe(200);
    const rows = (await queries("sc_stq_send")).results;
    // ONE row, not two. This asserted two at integration, and two was the
    // defect: `send-to-query` records an EMPTY `pending` clarification to put
    // the deck on the list, and composing the letter is the second half of that
    // same act, so it must FILL that row rather than insert beside it. Leaving
    // both behind gives the founder a query nobody can answer, a second line on
    // the Query screen, a `query_count` of 2 that `deckListRoute` reads, and a
    // permanently-unanswered row the no-response sweep would archive the deck
    // for. `e2e/query.spec.ts:176` asserts one row per founder and caught it.
    expect(rows).toHaveLength(1);
    expect(rows[0].questions).toBe("Please send your phone number.");
  });

  it("is role-gated, and 404s an unknown deck", async () => {
    const cookie = await login(SUPER);
    expect(
      (await SELF.fetch(`${BASE}/api/decks/sc_nope_q/send-to-query`, { method: "POST", headers: { cookie } })).status,
    ).toBe(404);

    await seedDeck("sc_stq_role", { complete: false });
    await evaluate("sc_stq_role", 8, false);
    // NEGATIVE CONTROL — a juror does not run the founder-query loop.
    const jury = await login(JURY);
    expect(
      (await SELF.fetch(`${BASE}/api/decks/sc_stq_role/send-to-query`, { method: "POST", headers: { cookie: jury } }))
        .status,
    ).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// His open item · "queried, and the founder never responds"
// ═══════════════════════════════════════════════════════════════════════════

describe("the no-response sweep archives a query nobody answered", () => {
  /** Backdate the deck's newest query so it is past the working-day window. */
  async function backdate(id: string, daysAgo: number) {
    const when = new Date(Date.now() - daysAgo * 86400_000).toISOString();
    await env.DB.prepare("UPDATE queries SET created_at = ? WHERE deck_id = ?").bind(when, id).run();
  }

  async function raiseQuery(id: string, cookie: string) {
    const res = await SELF.fetch(`${BASE}/api/decks/${id}/queries`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ questions: "Please send your phone number." }),
    });
    expect(res.status).toBe(200);
  }

  it("archives it with the reason 'no response', which exit_note already surfaces", async () => {
    const cookie = await login(SUPER);
    await seedDeck("sc_nr", { complete: false });
    await evaluate("sc_nr", 8, false);
    await raiseQuery("sc_nr", cookie);
    // Comfortably past five WORKING days however the weekend falls.
    await backdate("sc_nr", 20);

    const swept = await runNoResponseSweep(env as Env, "incubator");
    expect(swept.map((s) => s.deckId)).toContain("sc_nr");

    const view = (await deck("sc_nr", cookie)) as Row & { exitNote?: string; exitAction?: string };
    expect(view.statusId).toBe("archived");
    // No schema for the reason: `exit_note` reads `pipeline_events.note`, so
    // "Archived — no response" is an ordinary archive event with a note.
    expect(view.exitNote).toBe("no response");
    expect(view.exitAction).toBe("archive");
    // The twelfth status his lists imply but do not name, and it lands in the
    // Archived box (C15) rather than nowhere.
    expect(screeningStatus(view as ScreeningDeck, { gate: GATE })).toBe("archived");
  });

  it("leaves a deck the founder ANSWERED alone, however old the letter is", async () => {
    const cookie = await login(SUPER);
    await seedDeck("sc_nr_answered", { complete: false });
    await evaluate("sc_nr_answered", 8, false);
    await raiseQuery("sc_nr_answered", cookie);
    await backdate("sc_nr_answered", 40);
    await env.DB.prepare("UPDATE queries SET founder_response = 'Here it is.' WHERE deck_id = ?")
      .bind("sc_nr_answered")
      .run();

    const swept = await runNoResponseSweep(env as Env, "incubator");
    expect(swept.map((s) => s.deckId)).not.toContain("sc_nr_answered");
    expect((await deck("sc_nr_answered", cookie)).statusId).not.toBe("archived");
  });

  it("leaves one INSIDE the window alone — the rule is lateness, not age", async () => {
    const cookie = await login(SUPER);
    await seedDeck("sc_nr_fresh", { complete: false });
    await evaluate("sc_nr_fresh", 8, false);
    await raiseQuery("sc_nr_fresh", cookie);
    // One working day is inside a five-working-day window under any weekend.
    await backdate("sc_nr_fresh", 1);

    expect((await runNoResponseSweep(env as Env, "incubator")).map((s) => s.deckId)).not.toContain("sc_nr_fresh");
    expect((await deck("sc_nr_fresh", cookie)).statusId).not.toBe("archived");
    expect(QUERY_RESPONSE_WORKING_DAYS).toBe(5);
  });

  it("does not archive a deck that has moved PAST screening on an old query", async () => {
    const cookie = await login(SUPER);
    await seedDeck("sc_nr_moved", { complete: false });
    await evaluate("sc_nr_moved", 8, false);
    await raiseQuery("sc_nr_moved", cookie);
    await backdate("sc_nr_moved", 30);
    // A query raised long ago must not archive a startup that is now being
    // evaluated by the jury. The rule is about an unanswered clarification.
    await env.DB.prepare("UPDATE decks SET status = 'jury_evaluation' WHERE id = ?").bind("sc_nr_moved").run();

    expect((await runNoResponseSweep(env as Env, "incubator")).map((s) => s.deckId)).not.toContain("sc_nr_moved");
    expect((await deck("sc_nr_moved", cookie)).statusId).toBe("jury_evaluation");
  });

  it("is idempotent — a second pass finds nothing left to archive", async () => {
    const cookie = await login(SUPER);
    await seedDeck("sc_nr_twice", { complete: false });
    await evaluate("sc_nr_twice", 8, false);
    await raiseQuery("sc_nr_twice", cookie);
    await backdate("sc_nr_twice", 20);

    expect((await runNoResponseSweep(env as Env, "incubator")).map((s) => s.deckId)).toContain("sc_nr_twice");
    // `archived` is outside SWEEPABLE_STAGES, so the deck cannot be archived
    // twice and the daily cron is safe to run on a quiet database.
    expect((await runNoResponseSweep(env as Env, "incubator")).map((s) => s.deckId)).not.toContain("sc_nr_twice");
  });

  it("does NOT archive a deck whose query was never actually composed", async () => {
    // "Send to Query" records the send as a PENDING query with no questions
    // yet, and the operator composes afterwards. A deck sitting on the list
    // because staff never followed through has had no chance to respond, and
    // archiving it as "no response" would blame the founder for our inaction.
    const cookie = await login(SUPER);
    await seedDeck("sc_nr_uncomposed", { complete: false });
    await evaluate("sc_nr_uncomposed", 8, false);
    const sent = await SELF.fetch(`${BASE}/api/decks/sc_nr_uncomposed/send-to-query`, {
      method: "POST",
      headers: { cookie },
    });
    expect(sent.status).toBe(200);
    await backdate("sc_nr_uncomposed", 30);

    expect((await runNoResponseSweep(env as Env, "incubator")).map((s) => s.deckId)).not.toContain(
      "sc_nr_uncomposed",
    );
    expect((await deck("sc_nr_uncomposed", cookie)).statusId).not.toBe("archived");
  });

  it("is scoped to the edition it was asked about", async () => {
    // T1-PEOPLE's note lives on the sweep itself: this runs with no session and
    // therefore no tenant, so edition scoping is the only scoping it has today
    // and a tenant key threads through the same parameter.
    const vc = await runNoResponseSweep(env as Env, "vc");
    for (const s of vc) {
      const row = await env.DB.prepare("SELECT edition FROM decks WHERE id = ?")
        .bind(s.deckId)
        .first<{ edition: string }>();
      expect(row!.edition).toBe("vc");
    }
  });
});
