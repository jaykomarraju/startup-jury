import { SELF, env } from "cloudflare:test";
import { describe, it, expect, afterEach } from "vitest";
import { runReminders } from "../../src/server/scheduled";

/**
 * W7-E — Assign → Confirm assignment as the prototype does it
 * (`AISJ_IC_SuserV15/_scripts.js` asConfirm): every selected deck × every
 * selected member, one all-or-nothing write, a 7-day deadline, the optional
 * instructions, and the email. Plus the consumers that had to learn a deck can
 * have more than one evaluator: the jury scoring guard, "all evaluations
 * complete", the evaluator roster's workload, and the reminder sweep.
 *
 * Every test seeds its own decks — the seeded ones are shared with other files'
 * assertions and must not be moved from under them.
 */

const BASE = "https://example.com";
const PA = "sunita.rao@demo.startupjury.ai";
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

async function seedDeck(id: string, status = "ai_evaluated", name = id): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, r2_key, uploaded_by, founder, complete) VALUES (?, 'incubator', ?, ?, ?, 'inc_founder', 'Ada Founder', 1)",
  )
    .bind(id, name, status, `decks/${id}.pdf`)
    .run();
}

async function statusOf(id: string): Promise<string | undefined> {
  return (await env.DB.prepare("SELECT status FROM decks WHERE id = ?").bind(id).first<{ status: string }>())?.status;
}

async function assignmentRows(deckId: string) {
  return (
    await env.DB.prepare(
      "SELECT evaluator_id, assigned_by, assigned_at, due_at, note, notified FROM deck_assignments WHERE deck_id = ? ORDER BY evaluator_id",
    )
      .bind(deckId)
      .all<{ evaluator_id: string; assigned_by: string; assigned_at: string; due_at: string; note: string | null; notified: number }>()
  ).results;
}

async function coreKeys(): Promise<string[]> {
  return (
    await env.DB.prepare(
      "SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 AND informational = 0 ORDER BY sort_order",
    ).all<{ key: string }>()
  ).results.map((r) => r.key);
}

describe("POST /api/assignments — the cross product (F0190)", () => {
  it("gives every selected deck to every selected member, in one write", async () => {
    await seedDeck("as_x1", "ai_evaluated", "Alpha");
    await seedDeck("as_x2", "ai_evaluated", "Beta");
    const pa = await login(PA);
    const res = await post("/api/assignments", pa, {
      deckIds: ["as_x1", "as_x2"],
      assigneeIds: ["inc_jury", "inc_pm"],
      note: "Focus on traction and team slide.",
      notify: false,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      evaluations: number;
      dueAt: string;
      assignedAt: string;
      rows: { deckName: string; evaluatorName: string; roleLabel: string }[];
    };
    expect(body.evaluations).toBe(4);
    expect(body.rows.map((r) => `${r.deckName}→${r.evaluatorName}`)).toEqual([
      "Alpha→Rajesh Kumar",
      "Alpha→Raj Kumar",
      "Beta→Rajesh Kumar",
      "Beta→Raj Kumar",
    ]);
    expect(body.rows[1].roleLabel).toBe("Program Manager");

    for (const id of ["as_x1", "as_x2"]) {
      expect(await statusOf(id)).toBe("assigned");
      const rows = await assignmentRows(id);
      expect(rows.map((r) => r.evaluator_id)).toEqual(["inc_jury", "inc_pm"]);
      expect(rows.every((r) => r.assigned_by === "inc_pa")).toBe(true);
      expect(rows.every((r) => r.note === "Focus on traction and team slide.")).toBe(true);
    }
    // The first member selected is the deck's first assignee.
    const deck = await env.DB.prepare("SELECT assigned_to FROM decks WHERE id = 'as_x1'").first<{ assigned_to: string }>();
    expect(deck?.assigned_to).toBe("inc_jury");
  });

  it("stamps a deadline 7 days from the assignment date (F0210)", async () => {
    await seedDeck("as_due");
    const pa = await login(PA);
    const body = (await (
      await post("/api/assignments", pa, { deckIds: ["as_due"], assigneeIds: ["inc_jury"], notify: false })
    ).json()) as { dueAt: string; assignedAt: string };
    const days = (Date.parse(body.dueAt) - Date.parse(body.assignedAt)) / 86_400_000;
    expect(days).toBe(7);
    const [row] = await assignmentRows("as_due");
    expect(row.due_at).toBe(body.dueAt);
  });

  it("emails each member once when notify is on, and nobody when it is off (F0256)", async () => {
    await seedDeck("as_mail1", "ai_evaluated", "MailCo One");
    await seedDeck("as_mail2", "ai_evaluated", "MailCo Two");
    const pa = await login(PA);
    const on = (await (
      await post("/api/assignments", pa, {
        deckIds: ["as_mail1", "as_mail2"],
        assigneeIds: ["inc_jury", "inc_pm"],
        note: "Flag any ARR inconsistencies.",
      })
    ).json()) as { notified: number };
    expect(on.notified).toBe(2);
    const mails = (
      await env.DB.prepare(
        "SELECT to_email, subject, body FROM email_outbox WHERE kind = 'evaluator_assignment' AND body LIKE '%MailCo One%'",
      ).all<{ to_email: string; subject: string; body: string }>()
    ).results;
    expect(mails.map((m) => m.to_email).sort()).toEqual([JURY, PM].sort());
    expect(mails[0].subject).toBe("2 decks assigned to you for evaluation");
    expect(mails[0].body).toContain("MailCo Two");
    expect(mails[0].body).toContain("Flag any ARR inconsistencies.");
    expect((await assignmentRows("as_mail1")).every((r) => r.notified === 1)).toBe(true);

    await seedDeck("as_quiet", "ai_evaluated", "QuietCo");
    const off = (await (
      await post("/api/assignments", pa, { deckIds: ["as_quiet"], assigneeIds: ["inc_jury"], notify: false })
    ).json()) as { notified: number };
    expect(off.notified).toBe(0);
    const quiet = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_outbox WHERE kind = 'evaluator_assignment' AND body LIKE '%QuietCo%'",
    ).first<{ n: number }>();
    expect(quiet?.n).toBe(0);
  });
});

describe("POST /api/assignments — refusals write nothing (F0211)", () => {
  it("409s a mixed selection naming the deck that cannot move, and leaves the other untouched", async () => {
    await seedDeck("as_ok", "ai_evaluated", "Ready Co");
    await seedDeck("as_stuck", "pending_ai", "Stuck Co");
    const pa = await login(PA);
    const res = await post("/api/assignments", pa, { deckIds: ["as_ok", "as_stuck"], assigneeIds: ["inc_jury"] });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; decks: { id: string }[]; message: string };
    expect(body.error).toBe("not_assignable");
    expect(body.decks.map((d) => d.id)).toEqual(["as_stuck"]);
    expect(body.message).toContain("Stuck Co");
    expect(await statusOf("as_ok")).toBe("ai_evaluated");
    expect(await assignmentRows("as_ok")).toEqual([]);
  });

  it("adds evaluators to a deck already out for evaluation instead of refusing it", async () => {
    await seedDeck("as_more");
    const pa = await login(PA);
    expect((await post(`/api/decks/as_more/assign`, pa, { assigneeId: "inc_jury" })).status).toBe(200);
    const res = await post("/api/assignments", pa, { deckIds: ["as_more"], assigneeIds: ["inc_pm"], notify: false });
    expect(res.status).toBe(200);
    expect((await assignmentRows("as_more")).map((r) => r.evaluator_id)).toEqual(["inc_jury", "inc_pm"]);
    const deck = await env.DB.prepare("SELECT status, assigned_to FROM decks WHERE id = 'as_more'").first<{
      status: string;
      assigned_to: string;
    }>();
    expect(deck).toEqual({ status: "assigned", assigned_to: "inc_jury" });
    const event = await env.DB.prepare(
      "SELECT from_stage, to_stage, note FROM pipeline_events WHERE deck_id = 'as_more' ORDER BY created_at DESC, rowid DESC LIMIT 1",
    ).first<{ from_stage: string; to_stage: string; note: string }>();
    expect(event).toEqual({ from_stage: "assigned", to_stage: "assigned", note: "Evaluators added: Raj Kumar" });
  });

  it("validates the request: empty, unknown deck, non-evaluator member", async () => {
    await seedDeck("as_val");
    const pa = await login(PA);
    expect((await post("/api/assignments", pa, { deckIds: [], assigneeIds: ["inc_jury"] })).status).toBe(400);
    expect((await post("/api/assignments", pa, { deckIds: ["as_val"], assigneeIds: [] })).status).toBe(400);
    const unknown = await post("/api/assignments", pa, { deckIds: ["nope"], assigneeIds: ["inc_jury"] });
    expect(unknown.status).toBe(404);
    const founder = await post("/api/assignments", pa, { deckIds: ["as_val"], assigneeIds: ["inc_founder"] });
    expect(founder.status).toBe(400);
    expect(((await founder.json()) as { assigneeIds: string[] }).assigneeIds).toEqual(["inc_founder"]);
    expect(await statusOf("as_val")).toBe("ai_evaluated");
  });

  it("is refused to the jury (403)", async () => {
    await seedDeck("as_authz");
    const jury = await login(JURY);
    expect((await post("/api/assignments", jury, { deckIds: ["as_authz"], assigneeIds: ["inc_jury"] })).status).toBe(403);
    expect((await get("/api/assignments/board", jury)).status).toBe(403);
  });

  it("starts a new panel when a deck re-enters Assigned from the AI gate", async () => {
    await seedDeck("as_restore");
    await env.DB.prepare(
      "INSERT INTO deck_assignments (deck_id, evaluator_id, assigned_by, assigned_at) VALUES ('as_restore', 'inc_pm', 'inc_pa', '2026-01-01T00:00:00.000Z')",
    ).run();
    const pa = await login(PA);
    await post("/api/assignments", pa, { deckIds: ["as_restore"], assigneeIds: ["inc_jury"], notify: false });
    expect((await assignmentRows("as_restore")).map((r) => r.evaluator_id)).toEqual(["inc_jury"]);
  });
});

describe("a deck with several evaluators", () => {
  async function scoreAs(cookie: string, deckId: string) {
    const scores = (await coreKeys()).map((key) => ({ key, value: 6 }));
    return post(`/api/decks/${deckId}/evaluate`, cookie, { scores });
  }

  it("lets the SECOND assigned juror score — not only the first", async () => {
    await seedDeck("as_second");
    const pa = await login(PA);
    await post("/api/assignments", pa, { deckIds: ["as_second"], assigneeIds: ["inc_pm", "inc_jury"], notify: false });
    const jury = await login(JURY);
    expect((await scoreAs(jury, "as_second")).status).toBe(200);
  });

  it("still refuses a juror who is on no panel for the deck", async () => {
    await seedDeck("as_notmine");
    const pa = await login(PA);
    await post("/api/assignments", pa, { deckIds: ["as_notmine"], assigneeIds: ["inc_pm"], notify: false });
    const jury = await login(JURY);
    expect((await scoreAs(jury, "as_notmine")).status).toBe(403);
  });

  it("announces 'all evaluations complete' only once EVERY evaluator has scored", async () => {
    await seedDeck("as_panel", "ai_evaluated", "PanelCo");
    const pa = await login(PA);
    await post("/api/assignments", pa, { deckIds: ["as_panel"], assigneeIds: ["inc_jury", "inc_pm"], notify: false });
    const complete = () =>
      env.DB.prepare(
        "SELECT COUNT(*) AS n FROM notifications WHERE deck_id = 'as_panel' AND event_key = 'all_evaluations_complete'",
      ).first<{ n: number }>();

    await scoreAs(await login(JURY), "as_panel");
    expect((await complete())?.n).toBe(0);
    await scoreAs(await login(PM), "as_panel");
    expect((await complete())?.n).toBeGreaterThan(0);
  });

  it("counts toward every member's workload and carries a capacity (F0258)", async () => {
    await seedDeck("as_load");
    const pa = await login(PA);
    const before = await openDecksOf(pa, "inc_pm");
    await post("/api/assignments", pa, { deckIds: ["as_load"], assigneeIds: ["inc_jury", "inc_pm"], notify: false });
    const after = await openDecksOf(pa, "inc_pm");
    expect(after.openDecks).toBe(before.openDecks + 1);
    expect(after.capacity).toBe(10);
    expect((await openDecksOf(pa, "inc_jury")).capacity).toBe(6);

    await env.DB.prepare("UPDATE users SET evaluation_capacity = 15 WHERE id = 'inc_pm'").run();
    expect((await openDecksOf(pa, "inc_pm")).capacity).toBe(15);
    await env.DB.prepare("UPDATE users SET evaluation_capacity = NULL WHERE id = 'inc_pm'").run();
  });

  it("reminds the second evaluator too", async () => {
    await seedDeck("as_remind", "ai_evaluated", "RemindCo");
    const pa = await login(PA);
    await post("/api/assignments", pa, { deckIds: ["as_remind"], assigneeIds: ["inc_jury", "inc_pm"], notify: false });
    const reminders = await runReminders(env);
    expect(reminders.find((r) => r.evaluatorId === "inc_pm")?.deckNames).toContain("RemindCo");
    expect(reminders.find((r) => r.evaluatorId === "inc_jury")?.deckNames).toContain("RemindCo");
  });

  it("lists every assignee on the deck view", async () => {
    await seedDeck("as_view");
    const pa = await login(PA);
    await post("/api/assignments", pa, { deckIds: ["as_view"], assigneeIds: ["inc_jury", "inc_pm"], notify: false });
    const { decks } = (await (await get("/api/decks", pa)).json()) as {
      decks: { id: string; assigneeIds?: string[] }[];
    };
    expect(decks.find((d) => d.id === "as_view")?.assigneeIds?.sort()).toEqual(["inc_jury", "inc_pm"]);
  });
});

async function openDecksOf(cookie: string, id: string) {
  const body = (await (await get("/api/evaluators", cookie)).json()) as {
    groups: { members: { id: string; openDecks: number; capacity: number }[] }[];
  };
  return body.groups.flatMap((g) => g.members).find((m) => m.id === id)!;
}

describe("GET /api/assignments/board", () => {
  afterEach(async () => {
    await env.DB.prepare("UPDATE org_scoring_settings SET show_ai_score_to_jury = 1 WHERE edition = 'incubator'").run();
  });

  it("carries the AI's 13 core values, the role AI+ totals and the assignees", async () => {
    const pa = await login(PA);
    const { decks } = (await (await get("/api/assignments/board", pa)).json()) as {
      decks: Record<
        string,
        { core: { key: string; value: number }[]; additional: Record<string, number | null>; assignees: { id: string; dueAt: string | null }[] }
      >;
    };
    const finstack = decks.inc_deck_finstack;
    expect(finstack.core).toHaveLength(13);
    expect(finstack.core.map((s) => s.key)).toEqual(await coreKeys());
    expect(Object.keys(finstack.additional).sort()).toEqual(["jury", "program_associate", "program_manager"]);

    // TaxPilot seeds all 22 AI scores and one backfilled assignee (0058).
    const taxpilot = decks.inc_deck_taxpilot;
    expect(taxpilot.additional.program_associate).not.toBeNull();
    expect(taxpilot.additional.program_associate!).toBeLessThanOrEqual(30);
    expect(taxpilot.assignees.map((a) => a.id)).toEqual(["inc_jury"]);
    expect(taxpilot.assignees[0].dueAt).toBeTruthy();

    // Only the assignable stages are on the board.
    expect(decks.inc_deck_insureflow).toBeUndefined();
  });

  it("withholds the AI's numbers from an evaluator under blind scoring", async () => {
    // The seeded decks already carry the associate's own evaluation, which lifts
    // blindness — so use a deck they have NOT scored.
    await seedDeck("as_blind");
    await env.DB.prepare(
      "INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, created_at) " +
        "SELECT 'as_blind_ai', 'as_blind', NULL, 'ai', id, 7, '2026-09-01T00:00:00.000Z' FROM parameters WHERE edition = 'incubator' AND key = 'traction_validation'",
    ).run();
    const pa = await login(PA);
    const open = (await (await get("/api/assignments/board", pa)).json()) as {
      decks: Record<string, { core: unknown[]; withheld: boolean }>;
    };
    expect(open.decks.as_blind).toMatchObject({ withheld: false, core: [{ key: "traction_validation", value: 7 }] });

    await env.DB.prepare("UPDATE org_scoring_settings SET show_ai_score_to_jury = 0 WHERE edition = 'incubator'").run();
    const { decks } = (await (await get("/api/assignments/board", pa)).json()) as {
      decks: Record<string, { core: unknown[]; withheld: boolean }>;
    };
    expect(decks.as_blind.withheld).toBe(true);
    expect(decks.as_blind.core).toEqual([]);
    // …and it lifts where they have submitted.
    expect(decks.inc_deck_finstack.withheld).toBe(false);
  });
});

describe("migration 0058", () => {
  it("backfilled every seeded single assignee with a deadline", async () => {
    const rows = (
      await env.DB.prepare(
        "SELECT d.id, da.evaluator_id, da.due_at FROM decks d LEFT JOIN deck_assignments da ON da.deck_id = d.id AND da.evaluator_id = d.assigned_to " +
          "WHERE d.assigned_to IS NOT NULL AND d.id LIKE 'inc_deck_%'",
      ).all<{ id: string; evaluator_id: string | null; due_at: string | null }>()
    ).results;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.evaluator_id && r.due_at)).toBe(true);
  });
});
