import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { sweepShortlistCriteria } from "../../src/server/routes/pipeline";
import { runShortlistSweep } from "../../src/server/scheduled";
import type { Env } from "../../src/server/types";

// 23-Oct tracker rows 4 and 10 — "The startups are shortlisted as per the
// criteria set in the admin console. NO MANUAL SHORTLISTING SHOULD BE ALLOWED BY
// THE SYSTEM."
//
// Three things, each the one most likely to regress:
//
//   1. THE PERMISSION. No role reaches `shortlisted` by hand — the superuser
//      included — refused by the SERVER, on a deck that clears its floor with a
//      complete panel, so the refusal cannot be the floor's. This is the
//      negative control the brief asks for: before 23-Oct the programme
//      manager, admin and superuser rows below were 200s, and the deck moved.
//   2. THE AUTOMATIC PATH, across a panel of TWO: the first juror's submit
//      decides nothing; the second's shortlists, with nobody clicking.
//   3. THE SWEEP stays in its workspace: the criteria applied for one
//      organisation never move another's deck — with the control that the same
//      deck IS moved by its own workspace's sweep, so the probe is not vacuous.
//
// Storage is isolated per FILE (not per test): every fixture id is unique.

const BASE = "https://example.com";

// Seed logins (migrations/0002_seed.sql). The founder owns the decks below
// (`uploaded_by = 'inc_founder'`), so their refusal is not a 404 for scope.
const ROLES = {
  superuser: "priya.sharma@demo.startupjury.ai",
  admin: "nisha.kapoor@demo.startupjury.ai",
  program_manager: "raj.kumar@demo.startupjury.ai",
  program_associate: "sunita.rao@demo.startupjury.ai",
  jury: "rajesh.kumar@demo.startupjury.ai",
  founder: "meera.sharma@demo.startupjury.ai",
} as const;

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

async function statusOf(id: string): Promise<string> {
  return (await env.DB.prepare("SELECT status FROM decks WHERE id = ?").bind(id).first<{ status: string }>())!.status;
}

async function shortlistEvents(id: string): Promise<{ actor_id: string | null; action: string }[]> {
  return (
    await env.DB.prepare(
      "SELECT actor_id, action FROM pipeline_events WHERE deck_id = ? AND to_stage = 'shortlisted' ORDER BY created_at",
    )
      .bind(id)
      .all<{ actor_id: string | null; action: string }>()
  ).results;
}

/**
 * An incubator deck at `jury_evaluation` with a file, an AI score, its panel's
 * assignments and — optionally — each juror's finished evaluation.
 */
async function seedDeck(
  id: string,
  opts: { ai: number; panel: string[]; scored?: Record<string, number>; tenantId?: string },
): Promise<void> {
  const tenantId = opts.tenantId ?? "t_default";
  await env.DB.prepare(
    "INSERT INTO decks (id, tenant_id, edition, name, status, ai_score, assigned_to, r2_key, uploaded_by, founder, complete) " +
      "VALUES (?, ?, 'incubator', ?, 'jury_evaluation', ?, ?, ?, 'inc_founder', 'Ada Founder', 1)",
  )
    .bind(id, tenantId, `Criteria ${id}`, opts.ai, opts.panel[0] ?? null, `decks/${id}.pdf`)
    .run();
  await env.DECKS.put(`decks/${id}.pdf`, new Uint8Array([37, 80, 68, 70])); // "%PDF"
  for (const evaluator of opts.panel) {
    await env.DB.prepare(
      "INSERT INTO deck_assignments (deck_id, evaluator_id, assigned_by, assigned_at) VALUES (?, ?, 'inc_admin', '2026-10-23T00:00:00Z')",
    )
      .bind(id, evaluator)
      .run();
  }
  for (const [evaluator, total] of Object.entries(opts.scored ?? {})) {
    await env.DB.prepare(
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict) VALUES (?, ?, ?, ?, 'scored')",
    )
      .bind(`${id}_${evaluator}_ev`, id, evaluator, total)
      .run();
  }
}

async function paramKeys(): Promise<string[]> {
  return (
    await env.DB.prepare("SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 ORDER BY sort_order").all<{
      key: string;
    }>()
  ).results.map((r) => r.key);
}

// ── 1 · the permission ───────────────────────────────────────────────────────

describe("no role can shortlist an incubator deck by hand", () => {
  // AI 9 · jury 9 → 9.0 against the org threshold of 7.0, and the one juror has
  // scored: by the criteria this deck SHOULD be shortlisted. Every refusal below
  // is therefore the no-manual rule and never the floor or an unfinished panel.
  for (const [role, email] of Object.entries(ROLES)) {
    it(`${role} — 403 shortlist_automatic, and the deck stays where it was`, async () => {
      const id = `crit_manual_${role}`;
      await seedDeck(id, { ai: 9, panel: ["inc_jury"], scored: { inc_jury: 9 } });

      const res = await post(`/api/decks/${id}/transition`, await login(email), { action: "shortlist" });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string; message: string; score: number; minimum: number };
      expect(body.error).toBe("shortlist_automatic");
      expect(body.message).toContain("Shortlisting is automatic");
      // The refusal says what the deck stands at, so a screen can explain it.
      expect(body.score).toBe(9);
      expect(body.minimum).toBe(7);

      expect(await statusOf(id)).toBe("jury_evaluation");
      expect(await shortlistEvents(id)).toEqual([]);
    });
  }

  it("the other decision on the same stage is untouched — the programme manager still rejects", async () => {
    // The client took away the manual SHORTLIST. Reject stays a person's call
    // (the 3-Oct ruling: the final call on a deck is the incubator's).
    const id = "crit_reject_stays";
    await seedDeck(id, { ai: 2, panel: ["inc_jury"], scored: { inc_jury: 2 } });
    const res = await post(`/api/decks/${id}/transition`, await login(ROLES.program_manager), { action: "reject" });
    expect(res.status).toBe(200);
    expect(await statusOf(id)).toBe("rejected");
  });

  it("the VC edition's manual shortlist-to-partner is not touched (out of scope)", async () => {
    await env.DB.prepare(
      "INSERT INTO decks (id, edition, name, status, ai_score, r2_key, uploaded_by, complete) " +
        "VALUES ('crit_vc', 'vc', 'Criteria VC', 'associate_review', 9, 'decks/crit_vc.pdf', 'vc_analyst', 1)",
    ).run();
    await env.DECKS.put("decks/crit_vc.pdf", new Uint8Array([37, 80, 68, 70]));
    const res = await post("/api/decks/crit_vc/transition", await login("sunita.rao.vc@demo.startupjury.ai"), {
      action: "shortlist_to_partner",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await statusOf("crit_vc")).toBe("partner_review");
  });
});

// ── 2 · the automatic path, across a panel of two ────────────────────────────

describe("the criteria shortlist a deck when its whole panel has scored", () => {
  it("the first juror's submit decides nothing; the second's shortlists, as the system", async () => {
    const id = "crit_panel_two";
    // A programme manager and an associate scored nothing yet; the associate is
    // the panel's second member, an assignable evaluator who may submit.
    await seedDeck(id, { ai: 8, panel: ["inc_jury", "inc_pa"] });
    const keys = await paramKeys();

    const first = await post(`/api/decks/${id}/evaluate`, await login(ROLES.jury), {
      scores: keys.map((key) => ({ key, value: 8 })),
    });
    expect(first.status, await first.clone().text()).toBe(200);
    const firstBody = (await first.json()) as { status: string; shortlist: unknown };
    expect(firstBody.status).toBe("jury_evaluation");
    // Not judged at all — not "below the floor": the panel is not finished.
    expect(firstBody.shortlist).toBeNull();
    expect(await statusOf(id)).toBe("jury_evaluation");

    const second = await post(`/api/decks/${id}/evaluate`, await login(ROLES.program_associate), {
      scores: keys.map((key) => ({ key, value: 8 })),
    });
    expect(second.status, await second.clone().text()).toBe(200);
    const secondBody = (await second.json()) as { status: string; shortlist: { shortlisted: boolean } };
    expect(secondBody.status).toBe("shortlisted");
    expect(secondBody.shortlist.shortlisted).toBe(true);
    expect(await statusOf(id)).toBe("shortlisted");
    expect(await shortlistEvents(id)).toEqual([{ actor_id: null, action: "auto_shortlist" }]);

    // The panel's alert says what the criteria did, instead of asking the PM
    // for a shortlist decision that is no longer theirs to make.
    const alerts = (
      await env.DB.prepare(
        "SELECT body FROM notifications WHERE deck_id = ? AND event_key = 'all_evaluations_complete'",
      )
        .bind(id)
        .all<{ body: string }>()
    ).results;
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) expect(a.body).toContain("Shortlisted by the criteria");
  });

  it("a deck below the floor stays at jury evaluation, and the alert says why", async () => {
    const id = "crit_below";
    await seedDeck(id, { ai: 3, panel: ["inc_jury"] });
    const keys = await paramKeys();
    const res = await post(`/api/decks/${id}/evaluate`, await login(ROLES.jury), {
      scores: keys.map((key) => ({ key, value: 3 })),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { status: string; shortlist: { shortlisted: boolean; reason: string } };
    expect(body.status).toBe("jury_evaluation");
    expect(body.shortlist).toMatchObject({ shortlisted: false, reason: "below_floor" });
    expect(await shortlistEvents(id)).toEqual([]);
    const alert = await env.DB.prepare(
      "SELECT body FROM notifications WHERE deck_id = ? AND event_key = 'all_evaluations_complete' LIMIT 1",
    )
      .bind(id)
      .first<{ body: string }>();
    expect(alert!.body).toContain("Below the organisation's shortlist threshold");
    expect(alert!.body).toContain("waits at Jury Evaluation for the programme's decision");
  });
});

// ── 3 · the sweep stays in its workspace ─────────────────────────────────────

describe("sweepShortlistCriteria", () => {
  // Negative control, measured 23-Oct: un-scoping the sweep's own SELECT leaves
  // this GREEN — the foreign deck is listed, but `checkShortlistFloor` reads it
  // through the same scope, finds nothing and judges nothing — and un-scoping
  // that read and the UPDATE as well turns it red ("expected [ 'crit_other_
  // tenant', … ] to not include 'crit_other_tenant'"). Three layers, any one of
  // which holds; the probe is not vacuous, it is defended in depth.
  it("never moves another organisation's deck — and does move it for its own", async () => {
    // Another organisation's deck that the criteria WOULD shortlist: complete
    // panel, AI 9 · jury 9 against the default threshold of 7.0. Its juror is a
    // seeded user only because `deck_assignments` / `evaluations` carry foreign
    // keys to `users`; the panel question is asked by id and nothing here reads
    // the juror's own workspace.
    await seedDeck("crit_other_tenant", {
      ai: 9,
      panel: ["inc_jury"],
      scored: { inc_jury: 9 },
      tenantId: "t_probe_p4",
    });

    const mine = await sweepShortlistCriteria(env.DB, { tenantId: "t_default", edition: "incubator" });
    expect(mine.map((o) => o.deckId)).not.toContain("crit_other_tenant");
    expect(await statusOf("crit_other_tenant")).toBe("jury_evaluation");

    // The control: the fixture is real — its own workspace's sweep moves it.
    const theirs = await sweepShortlistCriteria(env.DB, { tenantId: "t_probe_p4", edition: "incubator" });
    expect(theirs).toEqual([expect.objectContaining({ deckId: "crit_other_tenant", shortlisted: true })]);
    expect(await statusOf("crit_other_tenant")).toBe("shortlisted");
  });

  it("does nothing for the VC edition", async () => {
    expect(await sweepShortlistCriteria(env.DB, { tenantId: "t_default", edition: "vc" })).toEqual([]);
  });
});

// ── 4 · what re-applies the criteria when the BAR moves ──────────────────────
//
// Nobody may click shortlist, so a deck waiting at Jury Evaluation that a lower
// floor would carry over it has to be moved by something. These are the three
// somethings (`docs/parity-requests/A-P4.md`, patch 3).

describe("lowering a floor shortlists the decks waiting under it", () => {
  async function put(path: string, cookie: string, body: unknown) {
    return SELF.fetch(`${BASE}${path}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("a programme's floor, lowered in the console, moves its waiting deck at once", async () => {
    await env.DB.prepare(
      "INSERT INTO programs (id, edition, name, shortlist_min, active, sort_order) VALUES ('prog_crit_lower', 'incubator', 'Criteria Lower', 9.5, 1, 99)",
    ).run();
    await seedDeck("crit_prog_lower", { ai: 8, panel: ["inc_jury"], scored: { inc_jury: 8 } });
    await env.DB.prepare("UPDATE decks SET program_id = 'prog_crit_lower' WHERE id = 'crit_prog_lower'").run();
    // 8.0 against 9.5: waiting, and the sweep agrees.
    const before = await sweepShortlistCriteria(env.DB, { tenantId: "t_default", edition: "incubator" });
    expect(before.find((o) => o.deckId === "crit_prog_lower")).toMatchObject({ shortlisted: false, reason: "below_floor" });

    const res = await put("/api/programs/prog_crit_lower", await login(ROLES.admin), { shortlistMin: 7.5 });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await statusOf("crit_prog_lower")).toBe("shortlisted");
    expect(await shortlistEvents("crit_prog_lower")).toEqual([{ actor_id: null, action: "auto_shortlist" }]);
  });

  it("the organisation's threshold, lowered on the Scoring framework, does the same", async () => {
    await seedDeck("crit_org_lower", { ai: 6, panel: ["inc_jury"], scored: { inc_jury: 6 } });
    const admin = await login(ROLES.admin);
    // 6.0 against the seeded 7.0.
    expect(await statusOf("crit_org_lower")).toBe("jury_evaluation");
    const res = await put("/api/config/scoring-framework", admin, { shortlistThreshold: 5.5 });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { shortlisted: number }).shortlisted).toBeGreaterThanOrEqual(1);
    expect(await statusOf("crit_org_lower")).toBe("shortlisted");
    await put("/api/config/scoring-framework", admin, { shortlistThreshold: 7 });
  });

  it("a Scoring-framework save that moves nothing the criteria read moves no deck", async () => {
    // Waiting and qualifying — 9.0 against 7.0 — but nothing has applied the
    // criteria to it yet. An unrelated toggle must not be what does.
    await seedDeck("crit_unrelated_save", { ai: 9, panel: ["inc_jury"], scored: { inc_jury: 9 } });
    const admin = await login(ROLES.admin);
    const res = await put("/api/config/scoring-framework", admin, { showAiScoreToJury: false });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { shortlisted: number }).shortlisted).toBe(0);
    expect(await statusOf("crit_unrelated_save")).toBe("jury_evaluation");
    await put("/api/config/scoring-framework", admin, { showAiScoreToJury: true });
    // Left waiting on purpose: the cron case below is the one that moves it.
  });

  it("the ten-minute cron catches whatever else moved the bar — every live workspace, incubator only", async () => {
    // A deck that meets the criteria with nothing left to submit: the state the
    // decks already waiting on the day this shipped are in.
    await seedDeck("crit_cron", { ai: 9, panel: ["inc_jury"], scored: { inc_jury: 9 } });
    const swept = await runShortlistSweep(env as Env);
    expect(swept.find((o) => o.deckId === "crit_cron")).toMatchObject({ shortlisted: true });
    expect(await statusOf("crit_cron")).toBe("shortlisted");
    // …and the one the unrelated save above rightly left alone.
    expect(await statusOf("crit_unrelated_save")).toBe("shortlisted");
  });
});
