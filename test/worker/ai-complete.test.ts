import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { evaluateDeck, type RawEvaluation } from "../../src/server/ai/evaluate";
import { v3StatusKey } from "../../src/shared/deckStats";
import type { Env } from "../../src/server/types";

/**
 * S1-DASH item 3 — `decks.ai_complete` (migration 0075) and the upward-only
 * re-derive it unblocks.
 *
 * Plan §8.1 reports a real defect and two reverted attempts at it: a deck held
 * back ONLY by missing founder details keeps `complete = 0` forever, so it
 * routes to Query with nothing left to ask. Both attempts changed what
 * `decks.complete` MEANS, and two tests pin that meaning from opposite sides —
 * `automation.test.ts` ("the column holds the ANDed value") and
 * `route-partition.test.ts` ("an edit must never LOWER it"). **Neither of those
 * files is touched by this work, and both must stay green unedited**; a new
 * column changes neither contract.
 *
 * What is asserted here:
 *   · evaluation writes the model's verdict ALONE into the new column, while
 *     `complete` keeps the ANDed value;
 *   · PATCH raises `complete` 0 -> 1 when the intake list empties AND the model
 *     passed — and declines when it did not (the negative control, which is
 *     also every row that predates the migration);
 *   · PATCH never lowers it.
 *
 * NB (worker-test gotcha, stated at the top of automation.test.ts): storage is
 * isolated per FILE, not per test, so every fixture below has a unique id.
 */

const BASE = "https://example.com";
const SUPER = "priya.sharma@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

function patch(id: string, cookie: string, body: Record<string, unknown>) {
  return SELF.fetch(`${BASE}/api/decks/${id}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface Marks {
  complete: number;
  ai_complete: number;
  missing_fields: string | null;
  status: string;
}

function marks(id: string): Promise<Marks | null> {
  return env.DB.prepare(
    "SELECT complete, ai_complete, missing_fields, status FROM decks WHERE id = ?",
  )
    .bind(id)
    .first<Marks>();
}

async function seedDeck(
  id: string,
  opts: { founderPhone?: string | null; city?: string | null; status?: string } = {},
): Promise<void> {
  const { founderPhone = null, city = null, status = "pending_ai" } = opts;
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, stage, city, founder, founder_email, founder_phone, " +
      "status, r2_key, uploaded_by, complete) " +
      "VALUES (?, 'incubator', ?, 'Seed', ?, 'Ada Founder', 'ada@testco.example', ?, ?, ?, 'inc_pa', 1)",
  )
    .bind(id, `Deck ${id}`, city, founderPhone, status, `decks/${id}.pdf`)
    .run();
  await env.DECKS.put(`decks/${id}.pdf`, new Uint8Array([37, 80, 68, 70]));
}

async function paramKeys(): Promise<string[]> {
  const rows = (
    await env.DB.prepare("SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 ORDER BY sort_order")
      .all<{ key: string }>()
  ).results;
  return rows.map((r) => r.key);
}

/** Run the AI path with a stubbed model verdict. */
async function evaluate(id: string, complete: boolean, score = 9) {
  const keys = await paramKeys();
  return evaluateDeck(env as Env, id, {
    callModel: async (): Promise<RawEvaluation> => ({
      complete,
      founder: "Ada Founder",
      founder_email: "ada@testco.example",
      scores: keys.map((key) => ({ key, value: score })),
    }),
  });
}

describe("evaluation records the model's verdict separately (0075)", () => {
  it("a readable deck with missing contacts: complete 0, ai_complete 1", async () => {
    // The exact shape automation.test.ts pins the ANDed value for — the model
    // said yes, the intake columns say no. Before 0075 the row remembered only
    // the AND, so "which of the two?" had no answer.
    await seedDeck("ac_contacts");
    const result = await evaluate("ac_contacts", true);
    expect(result.status).toBe("incomplete");

    expect(await marks("ac_contacts")).toMatchObject({
      complete: 0,
      ai_complete: 1,
      missing_fields: "founderPhone,city",
    });
  });

  it("an unreadable deck: both 0, whatever the contacts say", async () => {
    await seedDeck("ac_unreadable", { founderPhone: "+91 98450 12345", city: "Hyderabad" });
    await evaluate("ac_unreadable", false);

    expect(await marks("ac_unreadable")).toMatchObject({
      complete: 0,
      ai_complete: 0,
      missing_fields: null,
    });
  });

  it("a deck that passes both: both 1", async () => {
    await seedDeck("ac_clean", { founderPhone: "+91 98450 12345", city: "Hyderabad" });
    await evaluate("ac_clean", true);

    expect(await marks("ac_clean")).toMatchObject({ complete: 1, ai_complete: 1, missing_fields: null });
  });
});

describe("PATCH re-derives the mark UPWARD ONLY", () => {
  it("raises 0 -> 1 when the intake list empties and the model had passed", async () => {
    const cookie = await login(SUPER);
    await seedDeck("ac_fix");
    await evaluate("ac_fix", true);
    expect(await marks("ac_fix")).toMatchObject({ complete: 0, ai_complete: 1 });

    // Exactly what §8.1 describes: fill in what was asked for, and the deck
    // stops being held back by a question nobody can still answer.
    const res = await patch("ac_fix", cookie, { founderPhone: "+91 98450 12345", city: "Hyderabad" });
    expect(res.status).toBe(200);

    expect(await marks("ac_fix")).toMatchObject({ complete: 1, ai_complete: 1, missing_fields: null });
    // The stage is NOT moved — this repairs the mark, not the pipeline, and
    // `deckListRoute` reads the mark.
    expect((await marks("ac_fix"))!.status).toBe("incomplete");
  });

  // NEGATIVE CONTROL for the `ai_complete` arm of the guard. Remove it and the
  // re-derive launders an unreadable deck onto the Assign roster by typing a
  // phone number — the precise confusion 0075 exists to end.
  it("declines when the model itself failed the deck", async () => {
    const cookie = await login(SUPER);
    await seedDeck("ac_stuck");
    await evaluate("ac_stuck", false);
    expect(await marks("ac_stuck")).toMatchObject({ complete: 0, ai_complete: 0 });

    const res = await patch("ac_stuck", cookie, { founderPhone: "+91 98450 12345", city: "Hyderabad" });
    expect(res.status).toBe(200);

    // The intake list cleared; the mark did not move.
    expect(await marks("ac_stuck")).toMatchObject({ complete: 0, ai_complete: 0, missing_fields: null });
  });

  // The same shape as every row that existed when 0075 ran: the backfill is
  // `ai_complete = complete`, so a deck stopped by missing DETAILS is
  // indistinguishable from one stopped by an unreadable deck and stays stuck.
  // Stated in the migration and told to the client in plan §12 rather than
  // papered over — the remedy is a re-evaluation, not a backfill.
  it("a pre-migration row stays stuck, and the test says so on purpose", async () => {
    const cookie = await login(SUPER);
    await seedDeck("ac_legacy");
    await env.DB.prepare("UPDATE decks SET status = 'ai_evaluated', complete = 0, ai_complete = 0, missing_fields = 'founderPhone,city' WHERE id = ?")
      .bind("ac_legacy")
      .run();

    await patch("ac_legacy", cookie, { founderPhone: "+91 98450 12345", city: "Hyderabad" });
    expect(await marks("ac_legacy")).toMatchObject({ complete: 0, ai_complete: 0, missing_fields: null });

    // …and a re-evaluation is what clears it, because that writes a verdict.
    await evaluate("ac_legacy", true);
    expect(await marks("ac_legacy")).toMatchObject({ complete: 1, ai_complete: 1, missing_fields: null });
  });

  it("never lowers it — blanking a detail leaves the column alone", async () => {
    const cookie = await login(SUPER);
    await seedDeck("ac_blank", { founderPhone: "+91 98450 12345", city: "Hyderabad" });
    await evaluate("ac_blank", true);
    expect(await marks("ac_blank")).toMatchObject({ complete: 1, ai_complete: 1 });

    await patch("ac_blank", cookie, { founderPhone: "" });

    // route-partition.test.ts's contract, restated on the new column's file:
    // routing follows the LIVE missing list, so the mark must not move under
    // it. The deck leaves Assign because `isDeckComplete` ANDs the two.
    expect(await marks("ac_blank")).toMatchObject({
      complete: 1,
      ai_complete: 1,
      missing_fields: "founderPhone",
    });
  });

  it("an edit that changes nothing relevant does not raise a stuck deck", async () => {
    const cookie = await login(SUPER);
    await seedDeck("ac_sector");
    await evaluate("ac_sector", true);
    expect(await marks("ac_sector")).toMatchObject({ complete: 0, ai_complete: 1 });

    // Sector is never a required intake column (W7-B / F0227), so the list is
    // still short and the guard still holds.
    await patch("ac_sector", cookie, { sector: "Fintech" });
    expect(await marks("ac_sector")).toMatchObject({ complete: 0, missing_fields: "founderPhone,city" });
  });
});

describe("the API exposes the new column", () => {
  it("`GET /api/decks` carries aiComplete on every row", async () => {
    const cookie = await login(SUPER);
    const res = await SELF.fetch(`${BASE}/api/decks`, { headers: { cookie } });
    const body = (await res.json()) as { decks: { aiComplete?: boolean }[] };
    expect(body.decks.length).toBeGreaterThan(0);
    // Selected, not forgotten: a screen that cannot read it cannot tell the two
    // statuses apart, which is how this column gets quietly dropped again.
    for (const d of body.decks) expect(typeof d.aiComplete).toBe("boolean");
  });

  // The loop closed: the Dashboard's Status word, derived from a REAL response
  // rather than a hand-built fixture. All four combinations of
  // (ai_complete, missing_fields), each reached by an actual evaluation.
  it("the four statuses derive off the real payload", async () => {
    const cookie = await login(SUPER);

    await seedDeck("ac_v_contacts");                                            // (1, set)
    await evaluate("ac_v_contacts", true);
    await seedDeck("ac_v_deck", { founderPhone: "+91 98450 12345", city: "Pune" });  // (0, empty)
    await evaluate("ac_v_deck", false);
    await seedDeck("ac_v_both");                                                // (0, set)
    await evaluate("ac_v_both", false);
    await seedDeck("ac_v_ok", { founderPhone: "+91 98450 12345", city: "Pune" });    // (1, empty)
    await evaluate("ac_v_ok", true);

    const res = await SELF.fetch(`${BASE}/api/decks`, { headers: { cookie } });
    const { decks } = (await res.json()) as {
      decks: { id: string; aiComplete?: boolean; missingFields?: string[]; statusId?: string; aiScore?: number }[];
    };
    const status = (id: string) => v3StatusKey(decks.find((d) => d.id === id)!);

    expect(status("ac_v_contacts")).toBe("incompleteContact");
    expect(status("ac_v_deck")).toBe("incompleteDeck");
    expect(status("ac_v_both")).toBe("incompleteDeck");
    expect(status("ac_v_ok")).toBe("aieval");
  });
});

/**
 * 21-Sep item 6 — "Contact Details Edited", the fourth post-action Status word.
 *
 * It could not be rendered: `PATCH /api/decks/:id` updated the deck and wrote
 * NO `pipeline_events` row, so nothing recorded that an edit had happened and
 * the chip had no source. That is now one event per contact correction, which
 * also repairs the deck's own history — until now a correction was invisible
 * there too.
 */
describe("a contact correction is recorded, not just applied", () => {
  const events = (id: string) =>
    env.DB.prepare(
      "SELECT action, from_stage, to_stage, note FROM pipeline_events WHERE deck_id = ? AND action = 'edit_contact'",
    )
      .bind(id)
      .all<{ action: string; from_stage: string | null; to_stage: string; note: string | null }>();

  it("writes one edit_contact event naming the fields that changed", async () => {
    const su = await login(SUPER);
    await seedDeck("ce_write", { status: "incomplete" });
    expect((await events("ce_write")).results).toHaveLength(0);

    const res = await patch("ce_write", su, { founderPhone: "+91 90000 00001", city: "Pune" });
    expect(res.status).toBe(200);

    const rows = (await events("ce_write")).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe("city,founderPhone");
    // An edit is NOT a transition and must not read as one.
    expect(rows[0].from_stage).toBe("incomplete");
    expect(rows[0].to_stage).toBe("incomplete");
    // …and the deck did not move.
    expect((await marks("ce_write"))!.status).toBe("incomplete");
  });

  it("surfaces it as contactEditedAt on the deck view", async () => {
    const su = await login(SUPER);
    await seedDeck("ce_view", { status: "incomplete" });

    const before = await SELF.fetch(`${BASE}/api/decks/ce_view`, { headers: { cookie: su } });
    expect(((await before.json()) as { deck: { contactEditedAt?: string } }).deck.contactEditedAt).toBeUndefined();

    const res = await patch("ce_view", su, { founderPhone: "+91 90000 00002" });
    const body = (await res.json()) as { deck: { contactEditedAt?: string } };
    expect(body.deck.contactEditedAt).toEqual(expect.any(String));
  });

  it("a non-contact edit is not a contact edit", async () => {
    const su = await login(SUPER);
    await seedDeck("ce_other", { founderPhone: "+91 90000 00003", city: "Pune", status: "ai_evaluated" });
    // `sector` is an edit, and a real one — but it is not a CONTACT detail, so
    // claiming "Contact Details Edited" for it would name the wrong change.
    const res = await patch("ce_other", su, { sector: "Climatetech" });
    expect(res.status).toBe(200);
    expect((await events("ce_other")).results).toHaveLength(0);
  });

  it("does not disturb the exit-reason columns, which select on to_stage", async () => {
    const su = await login(SUPER);
    await seedDeck("ce_exit", { status: "incomplete" });
    await patch("ce_exit", su, { founderPhone: "+91 90000 00004" });
    // `exit_*` reads the latest event with to_stage IN ('rejected','archived').
    // An edit_contact row carries the deck's own stage, so it can never win.
    const res = await SELF.fetch(`${BASE}/api/decks/ce_exit`, { headers: { cookie: su } });
    const body = (await res.json()) as { deck: { exitAt?: string; exitAction?: string } };
    expect(body.deck.exitAt).toBeUndefined();
    expect(body.deck.exitAction).toBeUndefined();
  });
});
