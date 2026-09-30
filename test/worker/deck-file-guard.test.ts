import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

/**
 * F-FOUL — the deck-file precondition. Sep-2026 client feedback rows 8 and 12.
 *
 * His literal row 8 ("eval reports and scores without decks") is impossible and
 * structurally so — `scores.deck_id` and `evaluations.deck_id` are both
 * `TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE` — and row 12
 * ("startups without any decks, assigned to Jury") is not a defect in the
 * creation path either: `INSERT INTO decks` has one call site and it writes the
 * R2 object first. What he actually found was 34 demo fixtures with `r2_key`
 * NULL, 30 of them carrying 648 `scores` rows and 80 `evaluations` rows, and
 * the fact that NOTHING ANYWHERE ASKED. This file pins the question.
 *
 * One negative control per write path, because the paths do not share an
 * implementation and two of them are reachable independently:
 *
 *   1. POST /api/decks/:id/assign       — the purpose-built single-deck verb
 *   2. POST /api/decks/:id/transition   — the GENERIC dispatcher, which is why
 *      the guard is keyed off the action: guarding 1 and 3 alone leaves
 *      `{"action":"assign_jury"}` posted here as an open door to the same write
 *   3. POST /api/assignments            — the bulk verb, refusing through the
 *      channel it already had
 *   4. POST /api/decks/:id/evaluate     — the urgent one. An assignment is
 *      reversible; a submitted evaluation is a record.
 *
 * Plus the dangling-key case, which is the one a column-only guard would miss —
 * and would miss BECAUSE of our own seed migration.
 */

const BASE = "https://example.com";
const PA = "sunita.rao@demo.startupjury.ai"; // program_associate — may assign
const PM = "raj.kumar@demo.startupjury.ai"; // program_manager
const JURY = "rajesh.kumar@demo.startupjury.ai"; // jury — may score its own decks
const PDF = new Uint8Array([37, 80, 68, 70]); // "%PDF"

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

function post(path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

/**
 * `file: "none"` leaves `r2_key` NULL — a deck that was never stored.
 * `file: "dangling"` sets the key and writes NO object — the state migration
 * 0081 would produce on its own, and the one a column-only guard lets through.
 * `file: "present"` is a coherent deck.
 */
async function seedDeck(
  id: string,
  status: string,
  file: "none" | "dangling" | "present",
  opts: { assignedTo?: string } = {},
): Promise<void> {
  const key = file === "none" ? null : `decks/${id}.pdf`;
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, r2_key, assigned_to, uploaded_by, founder, complete) " +
      "VALUES (?, 'incubator', ?, ?, ?, ?, 'inc_founder', 'Ada Founder', 1)",
  )
    .bind(id, id, status, key, opts.assignedTo ?? null)
    .run();
  if (file === "present") await env.DECKS.put(key!, PDF);
}

async function statusOf(id: string): Promise<string | undefined> {
  return (await env.DB.prepare("SELECT status FROM decks WHERE id = ?").bind(id).first<{ status: string }>())
    ?.status;
}

async function coreKeys(limit = 3): Promise<string[]> {
  return (
    await env.DB.prepare(
      "SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 AND informational = 0 " +
        "ORDER BY sort_order LIMIT ?",
    )
      .bind(limit)
      .all<{ key: string }>()
  ).results.map((r) => r.key);
}

describe("the deck-file precondition — no file, no assignment", () => {
  it("refuses POST /decks/:id/assign, and writes nothing", async () => {
    await seedDeck("dfg_assign", "ai_evaluated", "none");
    const res = await post("/api/decks/dfg_assign/assign", await login(PA), { assigneeId: "inc_jury" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string; message: string };
    expect(body.error).toBe("no_pdf");
    expect(body.reason).toBe("no_key");
    expect(body.message).toContain("no uploaded deck");
    // The refusal is total: no stage move, no assignee, no join-table row.
    expect(await statusOf("dfg_assign")).toBe("ai_evaluated");
    const row = await env.DB.prepare(
      "SELECT assigned_to, (SELECT COUNT(*) FROM deck_assignments WHERE deck_id = 'dfg_assign') n FROM decks WHERE id = 'dfg_assign'",
    ).first<{ assigned_to: string | null; n: number }>();
    expect(row).toMatchObject({ assigned_to: null, n: 0 });
  });

  it("refuses the same write through the GENERIC transition dispatcher — the bypass", async () => {
    // This is the test that earns the action-keyed guard. A guard placed only on
    // the two purpose-built assign endpoints leaves this door open, and it
    // reaches the identical UPDATE.
    await seedDeck("dfg_transition", "ai_evaluated", "none");
    const res = await post("/api/decks/dfg_transition/transition", await login(PA), { action: "assign_jury" });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe("no_pdf");
    expect(await statusOf("dfg_transition")).toBe("ai_evaluated");
  });

  it("still lets every OTHER action through the dispatcher — the guard is action-keyed, not a freeze", async () => {
    // The negative control on the negative control. `flag_incomplete` has no
    // business reading a PDF, and a fileless deck is exactly the deck an
    // operator needs to be able to act on.
    await seedDeck("dfg_other", "manual_review", "none");
    const res = await post("/api/decks/dfg_other/transition", await login(PA), { action: "flag_incomplete" });
    expect(res.status).toBe(200);
    expect(await statusOf("dfg_other")).toBe("incomplete");
  });

  it("refuses one deck out of a bulk confirmation and writes NOTHING for the others (F0211)", async () => {
    await seedDeck("dfg_bulk_ok", "ai_evaluated", "present");
    await seedDeck("dfg_bulk_bad", "ai_evaluated", "none");
    const res = await post("/api/assignments", await login(PA), {
      deckIds: ["dfg_bulk_ok", "dfg_bulk_bad"],
      assigneeIds: ["inc_jury"],
      notify: false,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      decks: { id: string; reason: string }[];
      message: string;
    };
    expect(body.error).toBe("not_assignable");
    expect(body.decks).toEqual([{ id: "dfg_bulk_bad", name: "dfg_bulk_bad", status: "ai_evaluated", reason: "no_pdf" }]);
    // The message names the real cause. A fileless deck is not "wrong stage",
    // and the old single sentence would have said it was.
    expect(body.message).toContain("has no uploaded deck");
    expect(body.message).not.toContain("current stage");
    // All-or-nothing: the good deck did not move either.
    expect(await statusOf("dfg_bulk_ok")).toBe("ai_evaluated");
  });

  it("assigns normally when the file is really there", async () => {
    await seedDeck("dfg_happy", "ai_evaluated", "present");
    const res = await post("/api/decks/dfg_happy/assign", await login(PA), { assigneeId: "inc_jury" });
    expect(res.status).toBe(200);
    expect(await statusOf("dfg_happy")).toBe("assigned");
  });
});

describe("the deck-file precondition — no file, no evaluation", () => {
  it("refuses POST /decks/:id/evaluate, and records no score and no evaluation", async () => {
    // The urgent half. Without this a juror opens a deck whose PDF 404s, scores
    // all 13 parameters and produces a signed evaluation report.
    await seedDeck("dfg_eval", "assigned", "none", { assignedTo: "inc_jury" });
    const keys = await coreKeys();
    const res = await post("/api/decks/dfg_eval/evaluate", await login(JURY), {
      scores: keys.map((key) => ({ key, value: 8 })),
      remarks: "scored a deck nobody can read",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("no_pdf");
    expect(body.message).toContain("cannot be scored");
    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM scores WHERE deck_id = 'dfg_eval') s, " +
        "(SELECT COUNT(*) FROM evaluations WHERE deck_id = 'dfg_eval') e",
    ).first<{ s: number; e: number }>();
    expect(counts).toMatchObject({ s: 0, e: 0 });
    // And it did not advance to jury_evaluation on the way out.
    expect(await statusOf("dfg_eval")).toBe("assigned");
  });

  it("refuses staff too — the guard is about the deck, not the role", async () => {
    await seedDeck("dfg_eval_pm", "assigned", "none", { assignedTo: "inc_jury" });
    const res = await post("/api/decks/dfg_eval_pm/evaluate", await login(PM), {
      scores: (await coreKeys()).map((key) => ({ key, value: 7 })),
      remarks: "",
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe("no_pdf");
  });

  it("scores normally when the file is really there", async () => {
    await seedDeck("dfg_eval_ok", "assigned", "present", { assignedTo: "inc_jury" });
    const res = await post("/api/decks/dfg_eval_ok/evaluate", await login(JURY), {
      scores: (await coreKeys()).map((key) => ({ key, value: 7 })),
      remarks: "",
    });
    expect(res.status).toBe(200);
    expect(await statusOf("dfg_eval_ok")).toBe("jury_evaluation");
  });
});

describe("a key with nothing behind it — the case our own fix would have created", () => {
  // `r2_key IS NOT NULL` is not the question. Migration 0081 sets `r2_key` on 30
  // seeded decks, so a column-only guard would be satisfied by the very seed it
  // was written to reject — and `GET /api/decks/:id/file` already answers
  // `no_pdf` for a dangling key, so the UI would look identical while the guard
  // silently started passing. These two tests are why the single-deck paths pay
  // for an R2 `head()`.

  it("refuses assignment of a deck whose key points at nothing", async () => {
    await seedDeck("dfg_dangle_assign", "ai_evaluated", "dangling");
    const res = await post("/api/decks/dfg_dangle_assign/assign", await login(PA), { assigneeId: "inc_jury" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string; message: string };
    expect(body.error).toBe("no_pdf");
    expect(body.reason).toBe("no_object");
    expect(body.message).toContain("missing from storage");
    expect(await statusOf("dfg_dangle_assign")).toBe("ai_evaluated");
  });

  it("refuses evaluation of a deck whose key points at nothing", async () => {
    await seedDeck("dfg_dangle_eval", "assigned", "dangling", { assignedTo: "inc_jury" });
    const res = await post("/api/decks/dfg_dangle_eval/evaluate", await login(JURY), {
      scores: (await coreKeys()).map((key) => ({ key, value: 6 })),
      remarks: "",
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string; reason: string }).reason).toBe("no_object");
  });

  it("lets a dangling key through the BULK path, and says so out loud", async () => {
    // THE ASYMMETRY IS DELIBERATE AND IT IS PINNED HERE so nobody "tidies" it
    // into one function without seeing that it is a choice. One bulk
    // confirmation admits up to MAX_DECKS (100) decks; an R2 `head()` per row
    // would make a hundred sequential round trips out of one refusal check. The
    // column check catches the whole class the client reported, and the decks it
    // lets through are guarded one at a time at the moment a juror actually
    // scores them — which the evaluate test above pins.
    await seedDeck("dfg_bulk_dangle", "ai_evaluated", "dangling");
    const res = await post("/api/assignments", await login(PA), {
      deckIds: ["dfg_bulk_dangle"],
      assigneeIds: ["inc_jury"],
      notify: false,
    });
    expect(res.status).toBe(200);
    expect(await statusOf("dfg_bulk_dangle")).toBe("assigned");
    // …and evaluation, the write that matters, still refuses it.
    const evalRes = await post("/api/decks/dfg_bulk_dangle/evaluate", await login(JURY), {
      scores: (await coreKeys()).map((key) => ({ key, value: 6 })),
      remarks: "",
    });
    expect(evalRes.status).toBe(409);
  });
});

describe("the seed, and the two halves that must not drift apart", () => {
  // Migration 0081 sets the keys; scripts/seed-deck-assets.mjs puts the objects.
  // A .sql file cannot import a module, so the id list exists twice.
  //
  // THE TEXTUAL COMPARISON OF THE TWO LISTS IS NOT HERE, and deliberately: this
  // project runs inside workerd with no filesystem, and `?raw` cannot be typed
  // for it without referencing `vite/client`, whose ambient `ImportMetaEnv`
  // collides with `src/server/security.ts` across the whole worker program.
  // `scripts/seed-deck-assets.mjs` checks it itself instead, on every run — it
  // parses 0081's id list and exits non-zero on any difference, which is a
  // stronger guarantee than an assertion here, because the script is the thing
  // that would otherwise silently under-upload. What is pinned below is the
  // OUTCOME in the database.

  it("leaves the four deliberately fileless fixtures alone", async () => {
    // Three are `incomplete` — a deck whose intake failed is SUPPOSED to be thin
    // — and inc_deck_pitchloop is the AI-failure fixture whose whole purpose is
    // to have nothing to read. The suite asserts the graceful no-PDF path
    // against these, so they are load-bearing, not leftovers.
    const rows = (
      await env.DB.prepare(
        "SELECT id, r2_key FROM decks WHERE id IN " +
          "('inc_deck_payroute', 'inc_deck_meera_incomplete', 'vc_deck_northbeam', 'inc_deck_pitchloop')",
      ).all<{ id: string; r2_key: string | null }>()
    ).results;
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.r2_key === null)).toBe(true);
  });

  it("gives every other seeded deck a key the product itself would have written", async () => {
    // `'decks/' || id || '.pdf'` is `versionKey(id, 1)`: version 1 takes NO
    // `_v1` suffix. Every seeded deck is content_version 1.
    const bad = (
      await env.DB.prepare(
        "SELECT id, r2_key, content_version FROM decks " +
          "WHERE r2_key IS NOT NULL AND (id LIKE 'inc_deck_%' OR id LIKE 'vc_deck_%') " +
          "AND (r2_key != 'decks/' || id || '.pdf' OR content_version != 1)",
      ).all<{ id: string }>()
    ).results;
    expect(bad).toEqual([]);
    const n = await env.DB.prepare(
      "SELECT COUNT(*) n FROM decks WHERE r2_key IS NOT NULL AND (id LIKE 'inc_deck_%' OR id LIKE 'vc_deck_%')",
    ).first<{ n: number }>();
    expect(n!.n).toBe(30);
  });

  it("gives them the v1 history row 0016 intended and never got", async () => {
    // 0016_automation.sql backfills one `deck_versions` row per deck "that
    // already has a stored PDF, so the history view is never empty for a deck
    // that has one" — and inserted ZERO rows, because every seeded r2_key was
    // NULL at the time.
    const rows = (
      await env.DB.prepare(
        "SELECT v.deck_id, v.version, v.r2_key FROM deck_versions v JOIN decks d ON d.id = v.deck_id " +
          "WHERE d.id LIKE 'inc_deck_%' OR d.id LIKE 'vc_deck_%'",
      ).all<{ deck_id: string; version: number; r2_key: string }>()
    ).results;
    expect(rows).toHaveLength(30);
    expect(rows.every((r) => r.version === 1 && r.r2_key === `decks/${r.deck_id}.pdf`)).toBe(true);
  });

  it("no seeded deck carries evaluation data without a file any more — the Foul itself", async () => {
    // This is row 12 in one query. Before this session it answered 30.
    const row = await env.DB.prepare(
      "SELECT COUNT(DISTINCT d.id) n FROM decks d " +
        "WHERE d.r2_key IS NULL AND (EXISTS (SELECT 1 FROM scores s WHERE s.deck_id = d.id) " +
        "OR EXISTS (SELECT 1 FROM evaluations e WHERE e.deck_id = d.id))",
    ).first<{ n: number }>();
    expect(row!.n).toBe(0);
  });
});
