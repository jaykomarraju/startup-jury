import { SELF, env } from "cloudflare:test";
import { describe, it, expect, afterEach } from "vitest";

/**
 * V4-ROUTE — the client's items 6 and 7, 2026-09-20:
 *
 *   "in the stat box of 'Evaluated' only the ones that are marked 'complete' in
 *    the status column have to be sent to 'assign' … Similarly, the ones that
 *    are marked 'incomplete' have to go to 'Query'."
 *
 * He is describing a guard on a bulk action this build does not have. In our
 * architecture the same sentence is a routing invariant, so it is asserted here
 * on the **RESPONSE** of the list each screen reads — never on the DOM, and
 * never on the client predicate, because the point of the change is that the
 * partition holds however the deck arrived at its stage.
 *
 * Two of the three drift paths measured in plan §4.1 are reproduced end to end:
 * (b) a details edit that blanks a required column on an evaluated deck, and
 * (c) `approve_review`, which walks a deck marked incomplete onto `ai_evaluated`
 * without consulting the mark.
 *
 * ── S2-SERVER, 2026-09-30 · HALF OF WHAT THIS FILE PINNED IS NOW DELETED ────
 * The client's feedback row 3 keeps the first of his two sentences and deletes
 * the second. "Only the ones marked complete have to be sent to Assign" is
 * unchanged and every Assign assertion below still holds. But "similarly, the
 * ones marked incomplete have to go to Query" was implemented as a DERIVATION,
 * and he now wants that routing to happen only when an operator clicks — his
 * reason being that a deck with incomplete contact details cannot be emailed,
 * for want of contact details.
 *
 * So `?list=query` means **queried** — there is a `queries` row — and a deck
 * that is incomplete and has not been sent is on NEITHER list. Three tests here
 * asserted the deleted conclusion and are rewritten rather than adjusted: each
 * one now pins that the deck leaves Assign, does NOT appear on Query, and is
 * still in the unfiltered response, which is the invariant that replaced it.
 * Nothing is lost by being on neither list: the uploaded status screen draws
 * every deck, always (`matchesV3Stat(d, "all")`).
 *
 * The negative control for the OTHER direction is what matters most now, and it
 * is the last test in the file: VC is unchanged, because his spec is the
 * incubator's.
 */

const BASE = "https://example.com";
const SU = "priya.sharma@demo.startupjury.ai";
const VC_SU = "aarav.khanna@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

interface Row {
  id: string;
  name: string;
  statusId?: string;
  complete?: boolean;
  aiScore?: number;
  missingFields?: string[];
}

async function list(cookie: string, which?: "assign" | "query"): Promise<Row[]> {
  const res = await SELF.fetch(`${BASE}/api/decks${which ? `?list=${which}` : ""}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { decks: Row[] }).decks;
}

const names = (rows: Row[]) => rows.map((d) => d.name).sort();

/** The seed's own contact detail for the decks these tests edit and put back. */
const SEED_EMAIL = new Map<string, string>();

afterEach(async () => {
  for (const [id, email] of SEED_EMAIL) {
    await env.DB.prepare("UPDATE decks SET founder_email = ?, missing_fields = NULL WHERE id = ?")
      .bind(email, id)
      .run();
  }
  SEED_EMAIL.clear();
});

describe("GET /api/decks?list= — the Assign/Query partition", () => {
  it("partitions the seed, and the two lists are disjoint", async () => {
    const cookie = await login(SU);
    const all = await list(cookie);
    const assign = await list(cookie, "assign");
    const query = await list(cookie, "query");

    // Measured baseline: 3 assignable and 15 decks in all, both unchanged by
    // row 3 — the Assign arm is the half of his sentence that survives.
    expect(names(assign)).toEqual(["FinStack", "GreenGrid Energy", "TaxPilot"]);
    // Query was ["NimbusHR", "PayRoute"] and is now NimbusHR alone. NimbusHR
    // has a `queries` row; PayRoute has none and was listed purely because its
    // stage is `incomplete` — which is the derivation row 3 deletes.
    expect(names(query)).toEqual(["NimbusHR"]);
    expect(query[0].id).toBe(all.find((d) => d.name === "NimbusHR")!.id);
    // …and PayRoute is on neither list while still being in the whole table.
    expect(names(assign)).not.toContain("PayRoute");
    expect(names(all)).toContain("PayRoute");

    const assignIds = new Set(assign.map((d) => d.id));
    expect(query.filter((d) => assignIds.has(d.id))).toEqual([]);
    // Neither list may invent a deck, and the unfiltered response still carries
    // the whole table — the Dashboard removes nothing (§4.1).
    const allIds = new Set(all.map((d) => d.id));
    for (const d of [...assign, ...query]) expect(allIds.has(d.id)).toBe(true);
    expect(all.length).toBeGreaterThan(assign.length + query.length);
  });

  it("every deck on Assign is marked complete; every deck on Query is not", async () => {
    const cookie = await login(SU);
    for (const d of await list(cookie, "assign")) {
      expect(d.complete).toBe(true);
      expect(d.missingFields ?? []).toEqual([]);
    }
    for (const d of await list(cookie, "query")) {
      expect(d.complete === false || (d.missingFields ?? []).length > 0).toBe(true);
    }
  });

  it("SENDS the mark, so a fail-open cannot hide behind the DEFAULT 1 reading", async () => {
    // `isDeckComplete` reads an absent `complete` as complete, on purpose: a
    // caller that forgot the column loses the new arm rather than emptying the
    // Assign screen. That only stays safe while the field is actually present.
    const cookie = await login(SU);
    const all = await list(cookie);
    expect(all.length).toBeGreaterThan(0);
    for (const d of all) expect(typeof d.complete).toBe("boolean");
  });

  it("(b) blanking a required detail takes an evaluated deck OFF Assign — and row 3 leaves it on neither list", async () => {
    const cookie = await login(SU);
    const before = { assign: await list(cookie, "assign"), query: await list(cookie, "query") };
    const fin = before.assign.find((d) => d.name === "FinStack")!;
    const seeded = await env.DB.prepare("SELECT founder_email AS e FROM decks WHERE id = ?")
      .bind(fin.id)
      .first<{ e: string }>();
    SEED_EMAIL.set(fin.id, seeded!.e);

    const patch = await SELF.fetch(`${BASE}/api/decks/${fin.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ founderEmail: "" }),
    });
    expect(patch.status).toBe(200);

    const after = {
      assign: await list(cookie, "assign"),
      query: await list(cookie, "query"),
      all: await list(cookie),
    };
    // Before: Assign 3 · Query 1. After: Assign 2 · Query 1 — the deck LEFT
    // Assign, which is the half of his sentence that survives, and it did not
    // arrive on Query, which is row 3.
    expect(before.assign.length).toBe(3);
    expect(before.query.length).toBe(1);
    expect(after.assign.length).toBe(2);
    expect(after.query.length).toBe(1);
    expect(names(after.assign)).not.toContain("FinStack");
    expect(names(after.query)).not.toContain("FinStack");
    // And it is NOT LOST, which is the invariant that replaced "it moved". The
    // operator reaches it on the uploaded status screen — the unfiltered
    // response — and decides there whether to send it to Query.
    const stranded = after.all.find((d) => d.id === fin.id)!;
    // Its stage never changed — only the mark did, which is still the whole
    // point: routing follows the mark, not the stage it happens to sit at.
    expect(stranded.statusId).toBe("ai_evaluated");
    expect(stranded.complete).toBe(true);
    expect(stranded.missingFields).toEqual(["founderEmail"]);
  });

  it("(b) and putting the detail back moves it straight back to Assign", async () => {
    const cookie = await login(SU);
    const fin = (await list(cookie, "assign")).find((d) => d.name === "FinStack")!;
    const seeded = await env.DB.prepare("SELECT founder_email AS e FROM decks WHERE id = ?")
      .bind(fin.id)
      .first<{ e: string }>();
    SEED_EMAIL.set(fin.id, seeded!.e);

    for (const founderEmail of ["", seeded!.e]) {
      const res = await SELF.fetch(`${BASE}/api/decks/${fin.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ founderEmail }),
      });
      expect(res.status).toBe(200);
    }
    expect(names(await list(cookie, "assign"))).toContain("FinStack");
    expect(names(await list(cookie, "query"))).not.toContain("FinStack");
  });

  it("(c) a deck marked incomplete cannot reach Assign through manual review", async () => {
    const cookie = await login(SU);
    // Found on the WHOLE table, not on the Query list: under row 3 a deck that
    // was never sent to Query is not there to be found. The path this test
    // walks is unchanged and so is the thing it defends.
    const deck = (await list(cookie)).find((d) => d.name === "PayRoute")!;

    // The four transitions are all the superuser's, and all return 200 — this is
    // the reachable path, not a hypothetical one.
    for (const action of ["founder_response", "submit_for_ai", "send_to_review", "approve_review"]) {
      const res = await SELF.fetch(`${BASE}/api/decks/${deck.id}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ action }),
      });
      expect(res.status).toBe(200);
    }
    const raw = await env.DB.prepare("SELECT status, complete, missing_fields AS mf FROM decks WHERE id = ?")
      .bind(deck.id)
      .first<{ status: string; complete: number; mf: string | null }>();
    expect(raw).toEqual({ status: "ai_evaluated", complete: 0, mf: "founderPhone" });

    // On `main`, before V4-ROUTE, this deck was the fourth row of the Assign
    // roster. It still must not be.
    expect(names(await list(cookie, "assign"))).not.toContain("PayRoute");
    // Row 3: and it does not silently appear on Query either. Nobody sent it.
    expect(names(await list(cookie, "query"))).not.toContain("PayRoute");
    expect(names(await list(cookie))).toContain("PayRoute");

    // Put the stage back — this file's decks are shared with its siblings.
    await env.DB.prepare("UPDATE decks SET status = 'incomplete' WHERE id = ?").bind(deck.id).run();
  });

  it("an unrecognised ?list= value is the whole table, not an empty one", async () => {
    const cookie = await login(SU);
    const all = await list(cookie);
    expect((await list(cookie, "shortlisted" as never)).length).toBe(all.length);
  });

  // ── Negative control: the VC edition was not rescoped ─────────────────────
  it("changes nothing on VC — it has neither assignable stage", async () => {
    const cookie = await login(VC_SU);
    // `ASSIGNABLE_STAGES.vc` is empty because `src/pipeline/vc.ts` has no
    // `ai_evaluated` and no `assigned`, so the new arm of the invariant cannot
    // fire on a single VC deal in either direction.
    expect(await list(cookie, "assign")).toEqual([]);
    expect(names(await list(cookie, "query"))).toEqual(["Northbeam Robotics"]);
    const stages = (
      await env.DB.prepare("SELECT DISTINCT status AS s FROM decks WHERE edition = 'vc'").all<{ s: string }>()
    ).results.map((r) => r.s);
    expect(stages).not.toContain("ai_evaluated");
    expect(stages).not.toContain("assigned");
  });
});
