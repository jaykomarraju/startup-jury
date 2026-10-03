import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { evaluateDeck, type RawEvaluation } from "../../src/server/ai/evaluate";
import { runNoResponseSweep } from "../../src/server/scheduled";
// T1-PEOPLE — `runNoResponseSweep` takes a WORKSPACE now, not an edition: the cron
// has no session, so `scheduled.ts` enumerates `organizations` and hands one scope
// per pass. Every seeded row backfilled to `DEFAULT_TENANT_ID` (`0083`-`0100`), so
// these cases name the same workspace they always meant.
import { DEFAULT_TENANT_ID } from "../../src/shared/tenant";

const INC: TenantScope = { tenantId: DEFAULT_TENANT_ID, edition: "incubator" };
const VC: TenantScope = { tenantId: DEFAULT_TENANT_ID, edition: "vc" };
import { screeningStatus, type ScreeningDeck } from "../../src/shared/deckStats";
import { QUERY_RESPONSE_WORKING_DAYS } from "../../src/shared/queries";
import type { Env } from "../../src/server/types";
import type { TenantScope } from "../../src/shared/tenant";

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
  /** Oct-2026 issue 5 — how many times the AI has evaluated this deck. */
  evaluationRuns?: number;
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

    const swept = await runNoResponseSweep(env as Env, INC);
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

    const swept = await runNoResponseSweep(env as Env, INC);
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

    expect((await runNoResponseSweep(env as Env, INC)).map((s) => s.deckId)).not.toContain("sc_nr_fresh");
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

    expect((await runNoResponseSweep(env as Env, INC)).map((s) => s.deckId)).not.toContain("sc_nr_moved");
    expect((await deck("sc_nr_moved", cookie)).statusId).toBe("jury_evaluation");
  });

  it("is idempotent — a second pass finds nothing left to archive", async () => {
    const cookie = await login(SUPER);
    await seedDeck("sc_nr_twice", { complete: false });
    await evaluate("sc_nr_twice", 8, false);
    await raiseQuery("sc_nr_twice", cookie);
    await backdate("sc_nr_twice", 20);

    expect((await runNoResponseSweep(env as Env, INC)).map((s) => s.deckId)).toContain("sc_nr_twice");
    // `archived` is outside SWEEPABLE_STAGES, so the deck cannot be archived
    // twice and the daily cron is safe to run on a quiet database.
    expect((await runNoResponseSweep(env as Env, INC)).map((s) => s.deckId)).not.toContain("sc_nr_twice");
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

    expect((await runNoResponseSweep(env as Env, INC)).map((s) => s.deckId)).not.toContain(
      "sc_nr_uncomposed",
    );
    expect((await deck("sc_nr_uncomposed", cookie)).statusId).not.toBe("archived");
  });

  it("is scoped to the edition it was asked about", async () => {
    // T1-PEOPLE's note lives on the sweep itself: this runs with no session and
    // therefore no tenant, so edition scoping is the only scoping it has today
    // and a tenant key threads through the same parameter.
    const vc = await runNoResponseSweep(env as Env, VC);
    for (const s of vc) {
      const row = await env.DB.prepare("SELECT edition FROM decks WHERE id = ?")
        .bind(s.deckId)
        .first<{ edition: string }>();
      expect(row!.edition).toBe("vc");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · The gate is SERVED, and the Assign list consults it (issues 7, 8)
// ═══════════════════════════════════════════════════════════════════════════
//
// Both halves of one live defect, measured against production on 2026-10-01.
//
// § 3 above proves the gate is stored and enforced AT EVALUATION TIME. What it
// could not see is that nothing downstream ever read it back:
//
//   · `GET /api/config/summary` did not carry `aiGateThreshold`, and
//     `ConfigSummary` did not declare it, so the Dashboard reached for it
//     through a widening cast whose `typeof === "number"` guard was false on
//     every response. Every screening verdict on the screen was taken against a
//     hardcoded 5.0. It LOOKED right, because production holds 5 — the
//     migration's own default — which is why every test in this file passed
//     while the setting was being discarded.
//   · `GET /api/decks?list=assign` never asked the gate at all. Five production
//     decks scoring 2.66, 3.19, 4.00, 4.85 and 5.25 were all on the Assign
//     roster against a gate of 5. Only the last clears it.
//
// So the assertions below are deliberately about a gate that is NOT 5. A test
// written at the default agrees with the bug.

describe("the served gate — GET /api/config/summary carries it (issue 7)", () => {
  it("serves the org's own number, and the number MOVES when the setting does", async () => {
    const cookie = await login(SUPER);
    const summary = async () => {
      const res = await SELF.fetch(`${BASE}/api/config/summary`, { headers: { cookie } });
      expect(res.status).toBe(200);
      return (await res.json()) as { aiGateThreshold?: number; thresholdBest: number; thresholdMediocre: number };
    };

    await setGate(6.5);
    const raised = await summary();
    // Not 5. The whole defect was invisible at 5.
    expect(raised.aiGateThreshold).toBe(6.5);
    // The two neighbours did not move. Three numbers on one 0–10 scale, and
    // `routes/decks.ts:95-100` records a past confusion between two of them.
    expect(raised.thresholdBest).toBe(7);
    expect(raised.thresholdMediocre).toBe(5);

    await setGate(3);
    expect((await summary()).aiGateThreshold).toBe(3);
    await setGate(5);
  });

  it("the full admin config carries it too — `FullConfig extends ConfigSummary`", async () => {
    await setGate(6.5);
    const cookie = await login(ADMIN);
    const res = await SELF.fetch(`${BASE}/api/config`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { aiGateThreshold?: number }).aiGateThreshold).toBe(6.5);
    await setGate(5);
  });

  it("every role that screens gets it — the Dashboard is not admin-only", async () => {
    await setGate(6.5);
    for (const who of [SUPER, ADMIN, PM]) {
      const cookie = await login(who);
      const res = await SELF.fetch(`${BASE}/api/config/summary`, { headers: { cookie } });
      expect(((await res.json()) as { aiGateThreshold?: number }).aiGateThreshold, who).toBe(6.5);
    }
    await setGate(5);
  });
});

describe("?list=assign consults the gate (issue 8)", () => {
  it("drops a sub-gate deck from the Assign roster and keeps one at the gate", async () => {
    await setGate(5);
    const cookie = await login(SUPER);
    await seedDeck("sc_gate_low");
    await evaluate("sc_gate_low", 3);
    await seedDeck("sc_gate_at");
    await evaluate("sc_gate_at", 5);

    // Both are `ai_evaluated` and marked complete, which is everything
    // `deckListRoute` asks — so before this both were on the roster.
    for (const id of ["sc_gate_low", "sc_gate_at"]) {
      const view = await deck(id, cookie);
      expect(view.statusId, id).toBe("ai_evaluated");
      expect(view.aiComplete, id).toBe(true);
      expect(view.missingFields ?? [], id).toEqual([]);
    }

    const assign = await listNames(cookie, "assign");
    expect(assign).not.toContain("Deck sc_gate_low");
    // C13's `>=` reaches the LIST and not only the status word: a deck scoring
    // exactly the gate is Complete, so it is on Assign.
    expect(assign).toContain("Deck sc_gate_at");

    // Nothing is lost, which is his own display rule — "all decks, including
    // archived, stay on the uploaded status screen". The sub-gate deck is off
    // Assign, off Query, and still in the whole table where Reject is offered.
    expect(await listNames(cookie, "query")).not.toContain("Deck sc_gate_low");
    expect(await listNames(cookie)).toContain("Deck sc_gate_low");
  });

  it("it is the ORG's gate, not a constant — the same deck moves when the gate does", async () => {
    // The negative control for the whole section. With a hardcoded 5 every
    // other assertion here still passes; this one cannot, because 6 is above 5
    // and below 7 and the deck never changes.
    const cookie = await login(SUPER);
    await setGate(5);
    await seedDeck("sc_gate_moves");
    await evaluate("sc_gate_moves", 6);
    expect(await listNames(cookie, "assign")).toContain("Deck sc_gate_moves");

    await setGate(7);
    expect(await listNames(cookie, "assign")).not.toContain("Deck sc_gate_moves");

    await setGate(5);
    expect(await listNames(cookie, "assign")).toContain("Deck sc_gate_moves");
  });

  it("a deck already SENT to Assign stays on the roster, whatever it scored", async () => {
    // The carve-out, and it is not a nicety. Column 1 of the Assign screen keeps
    // allocated rows so a second juror can be added, and every deck evaluated
    // before today was routed with the gate unread — so a strict filter would
    // have taken decks off the screen they are already being worked on. It is
    // also `screeningStatus`'s own precedence: the `assigned` sink is answered
    // before the rating check ever runs, so the status vocabulary never calls an
    // allocated deck "Below threshold" and now neither does the list.
    await setGate(5);
    const cookie = await login(SUPER);
    await seedDeck("sc_gate_sent");
    await evaluate("sc_gate_sent", 3);
    expect(await listNames(cookie, "assign")).not.toContain("Deck sc_gate_sent");

    const res = await SELF.fetch(`${BASE}/api/decks/sc_gate_sent/send-to-assign`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await listNames(cookie, "assign")).toContain("Deck sc_gate_sent");
  });

  it("the QUERY arm is untouched — the gate narrows one list, not both", async () => {
    await setGate(7);
    const cookie = await login(SUPER);
    await seedDeck("sc_gate_query", { complete: false });
    await evaluate("sc_gate_query", 3, false);
    const raise = await SELF.fetch(`${BASE}/api/decks/sc_gate_query/queries`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ questions: "Please resend the deck." }),
    });
    expect(raise.status).toBe(200);
    // Scored 3 against a gate of 7 and on the Query list because somebody sent
    // it there. The gate has nothing to say about that: his third check is only
    // ever reached by a deck that is complete on both of the first two.
    expect(await listNames(cookie, "query")).toContain("Deck sc_gate_query");
    await setGate(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Oct-2026 issue 1 · his first two checks narrow the two rosters
// ═══════════════════════════════════════════════════════════════════════════

/**
 * His flow of 2026-10-02, which adds LIST MEMBERSHIP to what his §5 action
 * matrix already decided:
 *
 *   · incomplete CONTACT — off Assign AND off Query ("you cannot email a
 *     founder you cannot reach", the same reason he gave for row 3);
 *   · incomplete DECK with complete contacts — off Assign, still queryable,
 *     because `docs/spec_screening_flow.md` §3 item 1 makes Send to Query that
 *     state's only exit.
 *
 * Reached through the REAL evaluation path, like everything else in this file:
 * the model that cannot find a phone number is what writes `missing_fields`, and
 * a filter asserted against a hand-written row would not prove the server reads
 * the column the model wrote.
 */
describe("issue 1 — an incomplete deck is on neither roster", () => {
  /**
   * Evaluate a deck that has no phone number anywhere — the contact axis fails.
   *
   * The model's `null` alone is not enough, and that is worth stating: the
   * details are MERGED over the deck's own columns (`evaluate.ts:1004`,
   * `mergeIntakeDetails`) precisely so a bulk upload keeps whatever was typed at
   * intake, so the seeded phone number would survive a model that found none.
   * The column has to be empty too.
   */
  async function evaluateWithoutPhone(id: string, score: number, complete = true) {
    await env.DB.prepare("UPDATE decks SET founder_phone = NULL WHERE id = ?").bind(id).run();
    const keys = await paramKeys();
    return evaluateDeck(env as Env, id, {
      callModel: async (): Promise<RawEvaluation> => ({
        complete,
        founder: "Ada Founder",
        founder_email: "ada@testco.example",
        founder_phone: null,
        city: "Pune",
        sector: "B2B SaaS",
        scores: keys.map((key) => ({ key, value: score })),
      }),
    });
  }

  it("incomplete CONTACT is off Assign and off Query, even once it has been sent", async () => {
    await setGate(5);
    const cookie = await login(SUPER);
    await seedDeck("sc_i1_contact");
    await evaluateWithoutPhone("sc_i1_contact", 8);

    const view = await deck("sc_i1_contact", cookie);
    // The model read the deck perfectly well; the intake list is what failed.
    expect(view.aiComplete).toBe(true);
    expect(view.missingFields).toEqual(["founderPhone"]);
    expect(screeningStatus(view as ScreeningDeck, { gate: GATE })).toBe("incompleteContact");

    expect(await listNames(cookie, "assign")).not.toContain("Deck sc_i1_contact");
    // The CLICK is refused, with the same code the compose-and-send uses.
    const sent = await SELF.fetch(`${BASE}/api/decks/sc_i1_contact/send-to-query`, {
      method: "POST",
      headers: { cookie },
    });
    expect(sent.status).toBe(409);
    expect((await sent.json()) as { error: string }).toMatchObject({ error: "contact_incomplete" });
    expect((await deck("sc_i1_contact", cookie)).queried).toBe(false);

    // …and the LIST refuses it even when a `queries` row already exists, which
    // is the case the guard cannot cover: every deck queried before this rule
    // shipped. Written straight into the table, because that is what those rows
    // are — history, not a click this build would make.
    await env.DB.prepare(
      "INSERT INTO queries (id, deck_id, questions, email_status, created_at) VALUES (?, ?, '', 'pending', ?)",
    )
      .bind("qry_sc_i1_contact", "sc_i1_contact", new Date().toISOString())
      .run();
    expect((await deck("sc_i1_contact", cookie)).queried).toBe(true);
    expect(await listNames(cookie, "query")).not.toContain("Deck sc_i1_contact");
    // And it is NOT LOST: the uploaded status screen draws every deck, always.
    expect(await listNames(cookie)).toContain("Deck sc_i1_contact");
  });

  it("BOTH incomplete is off both too — the contact axis decides it", async () => {
    await setGate(5);
    const cookie = await login(SUPER);
    await seedDeck("sc_i1_both", { complete: false });
    await evaluateWithoutPhone("sc_i1_both", 8, false);
    const view = await deck("sc_i1_both", cookie);
    expect(screeningStatus(view as ScreeningDeck, { gate: GATE })).toBe("bothIncomplete");

    const sent = await SELF.fetch(`${BASE}/api/decks/sc_i1_both/send-to-query`, {
      method: "POST",
      headers: { cookie },
    });
    // The contact axis is what refuses it — the deck axis alone would have let
    // it through, which is the next test.
    expect(sent.status).toBe(409);
    expect(await listNames(cookie, "query")).not.toContain("Deck sc_i1_both");
    expect(await listNames(cookie, "assign")).not.toContain("Deck sc_i1_both");
  });

  it("incomplete DECK with complete contacts STAYS queryable (§3 item 1)", async () => {
    await setGate(5);
    const cookie = await login(SUPER);
    await seedDeck("sc_i1_deck", { complete: false });
    await evaluate("sc_i1_deck", 8, false);
    const view = await deck("sc_i1_deck", cookie);
    expect(screeningStatus(view as ScreeningDeck, { gate: GATE })).toBe("incompleteDeck");

    const sent = await SELF.fetch(`${BASE}/api/decks/sc_i1_deck/send-to-query`, {
      method: "POST",
      headers: { cookie },
    });
    expect(sent.status).toBe(200);
    // THE NEGATIVE CONTROL FOR THE WHOLE CHANGE: the only state whose single
    // exit is Send to Query keeps it. A filter that dropped this deck too would
    // satisfy his sentence and strand the deck for ever.
    expect(await listNames(cookie, "query")).toContain("Deck sc_i1_deck");
    expect(await listNames(cookie, "assign")).not.toContain("Deck sc_i1_deck");
  });

  it("a raised `complete` mark cannot carry an unread deck onto Assign", async () => {
    await setGate(5);
    const cookie = await login(SUPER);
    await seedDeck("sc_i1_raised", { complete: false });
    await evaluate("sc_i1_raised", 8, false);
    // The resubmit loop: the founder answers, `POST /api/queries/:id/respond`
    // sets `complete = 1` with no model re-read and no change to `ai_complete`,
    // and `restore` then walks the deck to `ai_evaluated` with no model run
    // either. `isDeckComplete` — `deckListRoute`'s own predicate — says this
    // deck is complete, which is why the roster asks the STATUS's axes instead.
    await raiseQueryAndAnswer("sc_i1_raised", cookie);
    await env.DB.prepare("UPDATE decks SET status = 'ai_evaluated' WHERE id = ?").bind("sc_i1_raised").run();

    const view = await deck("sc_i1_raised", cookie);
    expect(view.complete).toBe(true);
    expect(view.aiComplete).toBe(false);
    expect(screeningStatus(view as ScreeningDeck, { gate: GATE })).toBe("incompleteDeck");
    expect(await listNames(cookie, "assign")).not.toContain("Deck sc_i1_raised");
    expect(await listNames(cookie)).toContain("Deck sc_i1_raised");
  });

  it("Send to Assign is refused on an incomplete deck, on either axis", async () => {
    await setGate(5);
    const cookie = await login(SUPER);
    const sendToAssign = (id: string) =>
      SELF.fetch(`${BASE}/api/decks/${id}/send-to-assign`, { method: "POST", headers: { cookie } });

    // The marker is the ONLY authority for the `AI Evaluated, Assigned` sink and
    // the sink LATCHES the row (row 7 empties the whitelist), so a marker on an
    // incomplete deck would have the Dashboard calling a deck assigned while
    // `?list=assign` refuses it — two authorities for one fact, which is the
    // defect this route exists to avoid.
    await seedDeck("sc_i1_a_deck", { complete: false });
    await evaluate("sc_i1_a_deck", 8, false);
    expect((await sendToAssign("sc_i1_a_deck")).status).toBe(409);
    expect((await deck("sc_i1_a_deck", cookie)).sendToAssignAt).toBeUndefined();

    await seedDeck("sc_i1_a_contact");
    await evaluateWithoutPhone("sc_i1_a_contact", 8);
    expect((await sendToAssign("sc_i1_a_contact")).status).toBe(409);
    expect((await deck("sc_i1_a_contact", cookie)).sendToAssignAt).toBeUndefined();

    // NEGATIVE CONTROL — a complete deck still marks, and a deck below the gate
    // still marks: the rating check is deliberately NOT re-asked here, because
    // the roster's own `isAllocatedDeck` carve-out depends on a marked deck
    // staying listed whatever it scored.
    await seedDeck("sc_i1_a_ok");
    await evaluate("sc_i1_a_ok", 3);
    expect((await sendToAssign("sc_i1_a_ok")).status).toBe(200);
    expect((await deck("sc_i1_a_ok", cookie)).sendToAssignAt).toEqual(expect.any(String));
  });

  /** Query the deck and record a founder response — the shipped resubmit loop. */
  async function raiseQueryAndAnswer(id: string, cookie: string) {
    const raise = await SELF.fetch(`${BASE}/api/decks/${id}/queries`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ questions: "Please resend the deck." }),
    });
    expect(raise.status).toBe(200);
    const row = await env.DB.prepare("SELECT id FROM queries WHERE deck_id = ? LIMIT 1")
      .bind(id)
      .first<{ id: string }>();
    const res = await SELF.fetch(`${BASE}/api/queries/${row!.id}/respond`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ response: "Deck re-attached." }),
    });
    expect(res.status).toBe(200);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Oct-2026 issue 5 · "If a deck is reevaluated again … it should say reevaluated"
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The product CAN tell a re-run from a first run, with no migration:
 * `ai/evaluate.ts` writes one `pipeline_events` row per run at
 * `action = 'ai_evaluated'` under a fresh id, and nothing deletes them.
 *
 * The four candidates that CANNOT, each measured rather than assumed, are named
 * on `reevaluated` in `shared/deckStats.ts` — the `evaluations` AI row above all,
 * because it is the obvious one and it is deleted and re-inserted under a fixed
 * id on every run. That is asserted here.
 */
describe("issue 5 — the row says Reevaluated once the AI has read it twice", () => {
  it("serves the run count and flips the status on the second run", async () => {
    await setGate(5);
    const cookie = await login(SUPER);
    await seedDeck("sc_re_twice");

    await evaluate("sc_re_twice", 8);
    const first = await deck("sc_re_twice", cookie);
    expect(first.evaluationRuns).toBe(1);
    expect(screeningStatus(first as ScreeningDeck, { gate: GATE })).toBe("complete");

    await evaluate("sc_re_twice", 8);
    const second = await deck("sc_re_twice", cookie);
    expect(second.evaluationRuns).toBe(2);
    expect(screeningStatus(second as ScreeningDeck, { gate: GATE })).toBe("reevaluated");
    // Still assignable — the word is a fact about the deck's history, not a
    // change in what may be done to it.
    expect(await listNames(cookie, "assign")).toContain("Deck sc_re_twice");
  });

  it("the `evaluations` table could not have answered this", async () => {
    const cookie = await login(SUPER);
    await seedDeck("sc_re_source");
    await evaluate("sc_re_source", 8);
    await evaluate("sc_re_source", 6);

    const ai = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM evaluations WHERE deck_id = ? AND evaluator_id IS NULL",
    )
      .bind("sc_re_source")
      .first<{ n: number }>();
    // One row for two runs: evaluate.ts deletes the AI evaluation and re-inserts
    // it under the fixed id `${deckId}_ai_eval`.
    expect(ai!.n).toBe(1);

    const events = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM pipeline_events WHERE deck_id = ? AND action = 'ai_evaluated'",
    )
      .bind("sc_re_source")
      .first<{ n: number }>();
    expect(events!.n).toBe(2);
    expect((await deck("sc_re_source", cookie)).evaluationRuns).toBe(2);
  });

  it("a re-run does not relabel a deck whose word is an instruction", async () => {
    await setGate(5);
    const cookie = await login(SUPER);
    await seedDeck("sc_re_below");
    await evaluate("sc_re_below", 3);
    await evaluate("sc_re_below", 3);
    const view = await deck("sc_re_below", cookie);
    expect(view.evaluationRuns).toBe(2);
    // Below the gate on both runs, and "Below threshold" is why Reject is the
    // only action the row offers. The history must not overwrite that.
    expect(screeningStatus(view as ScreeningDeck, { gate: GATE })).toBe("belowThreshold");
  });
});
