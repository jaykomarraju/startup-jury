import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { evaluateDeck, type RawEvaluation } from "../../src/server/ai/evaluate";
import {
  matchesV3Stat,
  screeningStatus,
  v3DeckState,
  type ScreeningDeck,
  type StatDeck,
} from "../../src/shared/deckStats";
import type { Env } from "../../src/server/types";

/**
 * Oct-3 issues 10, 11, 12, 14 and 16 — **the stale pipeline stage.**
 *
 * One cause behind five tester rows: nothing moved a deck's STAGE off
 * `incomplete` when the operator supplied what made it incomplete. BiocharIND
 * passed both completeness axes and scored 5.14 against a gate of 5, so its
 * pill read "Complete, Edited" while `decks.status` still said `incomplete` —
 * and four systems key off that stage (the stat tile, the Assign/Query
 * partition, `reject_ai_gate`'s `from`, and Send to Assign's own guard).
 *
 * Every case below drives the REAL routes — evaluate, then
 * `PATCH /api/decks/:id` — and hands the served view to the same
 * `screeningStatus` / `matchesV3Stat` the Dashboard renders, because the bug
 * was precisely a disagreement between two readings of one row.
 *
 * The two negative controls are the point of the file, and they are the trap
 * the ground truth names: *the deck must go to the stage it has actually
 * REACHED.* A deck whose FILE the model could not read, and a deck the model
 * never scored at all, must stay where they are.
 *
 * NB (worker-test gotcha, stated at the top of `automation.test.ts`): storage
 * is isolated per FILE, not per test, so every fixture below has a unique id.
 * And no `beforeAll` inside a `describe` — that is rolled back
 * (`worker-tests-isolated-storage-beforeall`), so each case sets the gate.
 */

const BASE = "https://example.com";
const SUPER = "priya.sharma@demo.startupjury.ai";
const GATE = 5;

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

function setGate(value: number) {
  return env.DB.prepare("UPDATE org_scoring_settings SET ai_gate_threshold = ? WHERE edition = 'incubator'")
    .bind(value)
    .run();
}

async function seedDeck(id: string, opts: { status?: string; phone?: string | null } = {}): Promise<void> {
  const { status = "pending_ai", phone = null } = opts;
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, stage, city, founder, founder_email, founder_phone, " +
      "status, r2_key, uploaded_by, complete) " +
      "VALUES (?, 'incubator', ?, 'Seed', 'Pune', 'Ada Founder', 'ada@testco.example', ?, ?, ?, 'inc_pa', 1)",
  )
    .bind(id, `Deck ${id}`, phone, status, `decks/${id}.pdf`)
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

/**
 * Evaluate a deck with NO phone number anywhere, so the contact axis fails and
 * the deck lands at `incomplete` — the tester's starting state.
 *
 * The model's `null` alone is not enough: the details are MERGED over the
 * deck's own columns (`mergeIntakeDetails`), so the column has to be empty too.
 * `scores` is the knob the two negative controls turn — an empty array is a run
 * that produced no verdict at all.
 */
function evaluateWithoutPhone(
  id: string,
  opts: { score?: number; complete?: boolean; scored?: boolean } = {},
) {
  const { score = 6, complete = true, scored = true } = opts;
  return (async () => {
    await env.DB.prepare("UPDATE decks SET founder_phone = NULL WHERE id = ?").bind(id).run();
    const keys = scored ? await paramKeys() : [];
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
  })();
}

/** A clean run WITH a phone number — the deck lands at `ai_evaluated`. */
async function evaluateComplete(id: string, score: number) {
  const keys = await paramKeys();
  return evaluateDeck(env as Env, id, {
    callModel: async (): Promise<RawEvaluation> => ({
      complete: true,
      founder: "Ada Founder",
      founder_email: "ada@testco.example",
      founder_phone: "+91 90000 00000",
      city: "Pune",
      sector: "B2B SaaS",
      scores: keys.map((key) => ({ key, value: score })),
    }),
  });
}

interface Row {
  id: string;
  name: string;
  statusId?: string;
  status?: string;
  signal?: string;
  aiScore?: number;
  aiComplete?: boolean;
  complete?: boolean;
  missingFields?: string[];
  queried?: boolean;
  contactEditedAt?: string;
  evaluationRuns?: number;
  actions?: { action: string }[];
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

/** Supply the missing phone number through the route the operator uses. */
async function fixPhone(id: string, cookie: string) {
  const res = await SELF.fetch(`${BASE}/api/decks/${id}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ founderPhone: "+91 90000 00001" }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return res;
}

function events(id: string, action: string) {
  return env.DB.prepare(
    "SELECT from_stage, to_stage, action, actor_id, note FROM pipeline_events WHERE deck_id = ? AND action = ?",
  )
    .bind(id, action)
    .all<{ from_stage: string | null; to_stage: string; action: string; actor_id: string | null; note: string | null }>();
}

const actionIds = (view: Row) => (view.actions ?? []).map((a) => a.action);

// ═══════════════════════════════════════════════════════════════════════════
// Issues 10, 11 and 16 — BiocharIND / UshaKiran Ecoplast
// ═══════════════════════════════════════════════════════════════════════════

describe("a completed deck leaves the `incomplete` stage (issues 10, 11, 16)", () => {
  it("rejoins at ai_evaluated, lands in the AI Evaluated tile, and reaches Assign", async () => {
    await setGate(GATE);
    const cookie = await login(SUPER);
    await seedDeck("sr_biochar");
    await evaluateWithoutPhone("sr_biochar", { score: 6 });

    // ── Where the tester found it. Both stale columns, written by ONE branch of
    // `computeResult`: `!effective.complete` returns `status: 'incomplete'` AND
    // `signal: 'flagged'`, so a deck stopped by a missing phone number carries
    // both however well the model read it.
    const before = await deck("sr_biochar", cookie);
    expect(before.statusId).toBe("incomplete");
    expect(before.signal).toBe("flagged");
    expect(before.aiComplete).toBe(true);
    expect(before.aiScore).toBe(6);
    expect(before.missingFields).toEqual(["founderPhone"]);
    expect(screeningStatus(before as ScreeningDeck, { gate: GATE })).toBe("incompleteContact");
    expect(await listNames(cookie, "assign")).not.toContain("Deck sr_biochar");

    await fixPhone("sr_biochar", cookie);

    const after = await deck("sr_biochar", cookie);
    expect(after.missingFields ?? []).toEqual([]);
    expect(after.complete).toBe(true);
    // Issue 11 / 16 — the stage, and the SIGNAL. Asserting only the stage would
    // have left the row in the Incomplete tile, because `v3DeckState` reads
    // either column as "incomplete". The band is read off the score the AI
    // already stored, so nothing is invented: 6 is Moderate.
    expect(after.statusId).toBe("ai_evaluated");
    expect(v3DeckState(after as StatDeck)).toBe("aieval");
    expect(matchesV3Stat(after as StatDeck, "aieval")).toBe(true);
    expect(matchesV3Stat(after as StatDeck, "incomplete")).toBe(false);
    // The band itself, read off the score the AI already stored: 6 is Moderate.
    expect(after.signal).toBe("moderate");
    // The tester's own words: "Complete, Edited".
    expect(screeningStatus(after as ScreeningDeck, { gate: GATE })).toBe("completeEdited");

    // Issue 10, both halves. The roster holds it, so the Dashboard's guarded
    // navigation (`deckListRoute(...) === "assign"`) arms the button too — one
    // function answers both, which is why the list is the assertion.
    expect(await listNames(cookie, "assign")).toContain("Deck sr_biochar");
    const sent = await SELF.fetch(`${BASE}/api/decks/sr_biochar/send-to-assign`, {
      method: "POST",
      headers: { cookie },
    });
    expect(sent.status, await sent.text()).toBe(200);
  });

  it("records a SECOND event — a real transition — and leaves `edit_contact` a click", async () => {
    await setGate(GATE);
    const cookie = await login(SUPER);
    await seedDeck("sr_audit");
    await evaluateWithoutPhone("sr_audit", { score: 8 });
    await fixPhone("sr_audit", cookie);

    // The property that produced the bug is kept deliberately: an edit is not a
    // transition. Overloading this row would have made the history claim the
    // operator moved the deck by typing in a form.
    const edit = (await events("sr_audit", "edit_contact")).results;
    expect(edit).toHaveLength(1);
    expect(edit[0].from_stage).toBe("incomplete");
    expect(edit[0].to_stage).toBe("incomplete");

    // …and the stage move is its own row, with a real from/to, so the deck's
    // history reads truthfully instead of silently.
    const moved = (await events("sr_audit", "details_completed")).results;
    expect(moved).toHaveLength(1);
    expect(moved[0].from_stage).toBe("incomplete");
    expect(moved[0].to_stage).toBe("ai_evaluated");
    // Attributed to the operator who did it, not to the AI.
    expect(moved[0].actor_id).toBe("inc_superuser");

    // It must NOT be an `ai_evaluated` row: `evaluationRuns` counts those, and a
    // second one would relabel the deck "Reevaluated" for an edit the model
    // never saw (Oct-2026 issue 5).
    expect((await deck("sr_audit", cookie)).evaluationRuns).toBe(1);
    expect(screeningStatus((await deck("sr_audit", cookie)) as ScreeningDeck, { gate: GATE })).toBe("completeEdited");

    // And the exit-reason columns are untouched — they select on
    // `to_stage IN ('rejected','archived')`.
    const view = await deck("sr_audit", cookie);
    expect((view as unknown as { exitAt?: string }).exitAt).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Issues 12 and 14 — Scion Algae / MOSS AIR
// ═══════════════════════════════════════════════════════════════════════════

describe("a below-threshold deck gets its one button back (issues 12, 14)", () => {
  it("Reject and Archive are both offered once the stage is true", async () => {
    await setGate(GATE);
    const cookie = await login(SUPER);
    await seedDeck("sr_scion");
    await evaluateWithoutPhone("sr_scion", { score: 3 });

    // Why BOTH buttons read as inactive, and they are two different reasons.
    // `archive` IS permitted from `incomplete`, so it was offered all along —
    // Reject was not merely greyed, it was NEVER RENDERED: the Dashboard's
    // action cell can only draw options the server permitted for this stage,
    // and `reject_ai_gate` exists only `from: ai_evaluated`.
    const before = await deck("sr_scion", cookie);
    expect(before.statusId).toBe("incomplete");
    expect(actionIds(before)).toContain("archive");
    expect(actionIds(before)).not.toContain("reject_ai_gate");

    await fixPhone("sr_scion", cookie);

    const after = await deck("sr_scion", cookie);
    expect(after.statusId).toBe("ai_evaluated");
    expect(after.signal).toBe("weak");
    // His whitelist for this status is exactly ["reject_ai_gate", "archive"],
    // and now the permission layer carries both.
    expect(screeningStatus(after as ScreeningDeck, { gate: GATE })).toBe("belowThresholdEdited");
    expect(actionIds(after)).toContain("reject_ai_gate");
    expect(actionIds(after)).toContain("archive");

    const rejected = await SELF.fetch(`${BASE}/api/decks/sr_scion/transition`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "reject_ai_gate" }),
    });
    expect(rejected.status, await rejected.text()).toBe(200);
    expect((await deck("sr_scion", cookie)).statusId).toBe("rejected");
  });

  it("…and it does NOT reach Assign: the rejoin is not a way round the gate", async () => {
    await setGate(GATE);
    const cookie = await login(SUPER);
    await seedDeck("sr_mossair");
    await evaluateWithoutPhone("sr_mossair", { score: 3 });
    await fixPhone("sr_mossair", cookie);

    const after = await deck("sr_mossair", cookie);
    expect(after.statusId).toBe("ai_evaluated");
    // THE CONTROL FOR THE WHOLE CHANGE's blast radius. Moving the stage puts the
    // deck in `ASSIGNABLE_STAGES`, which is the one thing that could have
    // laundered a 3.0 onto the Assign roster behind the AI gate shipped on
    // 1-Oct. `gated()` still refuses it, and the Dashboard's Send to Assign is
    // the same predicate.
    expect(await listNames(cookie, "assign")).not.toContain("Deck sr_mossair");
    expect(await listNames(cookie)).toContain("Deck sr_mossair");
    const sent = await SELF.fetch(`${BASE}/api/decks/sr_mossair/send-to-assign`, {
      method: "POST",
      headers: { cookie },
    });
    // The marker route withholds the RATING check on purpose (an allocated deck
    // must not drop off the screen it is being worked on), so the gate is
    // enforced where it belongs — the roster above, and the whitelist, which
    // offers Reject at this status and not Send to Assign.
    expect(sent.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The band on its own — a deck that left `incomplete` by another route
// ═══════════════════════════════════════════════════════════════════════════

describe("the rating band is repaired even when the stage has already moved", () => {
  it("an archived-then-restored deck stops reading as Incomplete", async () => {
    await setGate(GATE);
    const cookie = await login(SUPER);
    await seedDeck("sr_restored");
    await evaluateWithoutPhone("sr_restored", { score: 8 });

    const transition = (action: string) =>
      SELF.fetch(`${BASE}/api/decks/sr_restored/transition`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
    expect((await transition("archive")).status).toBe(200);
    expect((await transition("restore")).status).toBe(200);

    // `restore` is `archived -> ai_evaluated` and runs no model, so the stage is
    // repaired and the BAND is not: the deck sits at a post-AI stage still
    // carrying the contact arm's `flagged`, and `v3DeckState` reads that alone
    // as "incomplete". This is the hole the stage condition would have left.
    const restored = await deck("sr_restored", cookie);
    expect(restored.statusId).toBe("ai_evaluated");
    expect(restored.signal).toBe("flagged");
    expect(v3DeckState(restored as StatDeck)).toBe("incomplete");

    await fixPhone("sr_restored", cookie);

    const after = await deck("sr_restored", cookie);
    expect(after.statusId).toBe("ai_evaluated");
    expect(after.signal).toBe("strong");
    expect(v3DeckState(after as StatDeck)).toBe("aieval");
    // No transition happened, so no transition is recorded. The `edit_contact`
    // row already says the operator changed something.
    expect((await events("sr_restored", "details_completed")).results).toHaveLength(0);
    expect((await events("sr_restored", "edit_contact")).results).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The negative controls — "the stage it has actually REACHED"
// ═══════════════════════════════════════════════════════════════════════════

describe("a deck that has not actually been evaluated stays where it is", () => {
  it("an UNREADABLE deck with complete contacts does not move (Turaga, issue 13)", async () => {
    await setGate(GATE);
    const cookie = await login(SUPER);
    await seedDeck("sr_turaga");
    // Scored, and still `complete: false` — the model read enough to score the
    // rubric and said the deck is not evaluable. That combination matters: it
    // leaves the DECK axis as the ONLY arm that can decline the rejoin, so this
    // case cannot pass by accident through the rubric-rows arm.
    await evaluateWithoutPhone("sr_turaga", { score: 6, complete: false });
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM scores WHERE deck_id = ? AND evaluator_kind = 'ai'",
        )
          .bind("sr_turaga")
          .first<{ n: number }>()
      )!.n,
    ).toBeGreaterThan(0);
    await fixPhone("sr_turaga", cookie);

    const after = await deck("sr_turaga", cookie);
    expect(after.aiComplete).toBe(false);
    expect(after.missingFields ?? []).toEqual([]);
    // The DECK axis still fails, so the stage is still true. Moving it would
    // announce an unreadable deck as evaluated AND take it off the Query roster
    // it had just become eligible for — §3 item 1 makes Send to Query this
    // state's ONE exit.
    expect(after.statusId).toBe("incomplete");
    expect((await events("sr_turaga", "details_completed")).results).toHaveLength(0);
    expect(screeningStatus(after as ScreeningDeck, { gate: GATE })).toBe("incompleteDeckEdited");

    const sent = await SELF.fetch(`${BASE}/api/decks/sr_turaga/send-to-query`, {
      method: "POST",
      headers: { cookie },
    });
    expect(sent.status, await sent.text()).toBe(200);
    expect(await listNames(cookie, "query")).toContain("Deck sr_turaga");
  });

  it("a deck the model READ but never SCORED does not move (UshaKiran, issue 15)", async () => {
    await setGate(GATE);
    const cookie = await login(SUPER);
    await seedDeck("sr_ushakiran");
    // ── The tester's issue 15 shape, and why the guard asks for RUBRIC ROWS ──
    //
    // The model said "complete" and returned no usable scores, so the row kept
    // `ai_complete = 1` with `ai_score = 0.00` — a truthful composite of
    // nothing, indistinguishable on that column from a deck that genuinely
    // scored low. The `ai_evaluated` event below is written on such a run too,
    // which is why it cannot be the authority either.
    //
    // Written straight into the table, because that is what these rows are:
    // **history**. `evaluateDeck` now refuses to persist a run that scored
    // nothing at all (`unscorableReason`, the issue-15 fix), so this shape can
    // no longer be reached through the AI path — and the production rows that
    // predate that fix still have to be handled correctly here.
    await env.DB.prepare(
      "UPDATE decks SET status = 'incomplete', ai_complete = 1, complete = 0, ai_score = 0, " +
        "signal = 'flagged', missing_fields = 'founderPhone', founder_phone = NULL WHERE id = ?",
    )
      .bind("sr_ushakiran")
      .run();
    await env.DB.prepare(
      "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) " +
        "VALUES (?, ?, NULL, 'pending_ai', 'incomplete', 'ai_evaluated', 'AI weighted total 0.00 · incomplete', ?)",
    )
      .bind("sr_ushakiran_evt_ai", "sr_ushakiran", new Date().toISOString())
      .run();

    const before = await deck("sr_ushakiran", cookie);
    expect(before.aiComplete).toBe(true);
    expect(before.aiScore).toBe(0);
    expect(before.evaluationRuns).toBe(1);

    await fixPhone("sr_ushakiran", cookie);

    const after = await deck("sr_ushakiran", cookie);
    expect(after.statusId).toBe("incomplete");
    expect(after.signal).toBe("flagged");
    expect((await events("sr_ushakiran", "details_completed")).results).toHaveLength(0);
  });

  it("a deck the AI has never run on does not move", async () => {
    await setGate(GATE);
    const cookie = await login(SUPER);
    // No evaluation at all — the shape a human `flag_incomplete` leaves behind,
    // which runs no model and writes no rubric rows. `ai_complete` defaults to 1
    // on such a row, so the deck axis cannot be what declines it.
    await seedDeck("sr_neverran", { status: "incomplete" });
    await fixPhone("sr_neverran", cookie);

    const after = await deck("sr_neverran", cookie);
    expect(after.statusId).toBe("incomplete");
    expect((await events("sr_neverran", "details_completed")).results).toHaveLength(0);
    // The `edit_contact` record is still written — the two are independent.
    expect((await events("sr_neverran", "edit_contact")).results).toHaveLength(1);
  });

  it("a deck already past `incomplete` is not dragged back to ai_evaluated", async () => {
    await setGate(GATE);
    const cookie = await login(SUPER);
    // Fully evaluated first, so the rubric rows exist and the DECK axis passes:
    // the only arm left to decline this is the STAGE. A deck that has been
    // shortlisted and then had a detail stripped out must not be walked
    // BACKWARDS to `ai_evaluated` by someone typing it back in.
    await seedDeck("sr_shortlisted", { phone: "+91 90000 00009" });
    await evaluateComplete("sr_shortlisted", 8);
    await env.DB.prepare(
      "UPDATE decks SET status = 'shortlisted', founder_phone = NULL, " +
        "missing_fields = 'founderPhone', complete = 0 WHERE id = ?",
    )
      .bind("sr_shortlisted")
      .run();
    await fixPhone("sr_shortlisted", cookie);

    const after = await deck("sr_shortlisted", cookie);
    expect(after.statusId).toBe("shortlisted");
    expect(after.signal).toBe("strong");
    expect((await events("sr_shortlisted", "details_completed")).results).toHaveLength(0);
  });
});
