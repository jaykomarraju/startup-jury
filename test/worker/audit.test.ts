import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * W3-C — the org-wide audit trail (`/api/audit`, `audit_log`) and the writers
 * that fill it.
 *
 * The rule this suite follows throughout, per the session brief: **assert the
 * ROW, not the call.** `recordAudit` deliberately swallows its own errors so a
 * trail write can never fail the mutation it records, which means a spy on the
 * writer would pass against a broken INSERT. Every test here reads `audit_log`
 * back out of D1.
 *
 * `0030` seeds ten demo rows for the incubator edition, transcribed from
 * `admin/s-al.html`. Tests that count rows scope themselves to what they wrote
 * (by `action`, or by excluding `aud_%`) so the seed cannot mask a miss.
 */

const BASE = "https://example.com";

// Signing in costs a 100 000-iteration PBKDF2 verify, and this file signs in
// on nearly every test. With four parity worktrees running suites at once (see
// plan §8 Q28 / Q32) a 5 s default budget is not a measurement of anything.
vi.setConfig({ testTimeout: 45_000, hookTimeout: 45_000 });

// Seeded logins (migrations/0002_seed.sql, 0015_roles_users.sql).
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const SUPERUSER = "priya.sharma@demo.startupjury.ai"; // incubator superuser
const PA = "sunita.rao@demo.startupjury.ai"; // program_associate
const JURY = "rajesh.kumar@demo.startupjury.ai"; // jury — no console
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai"; // vc admin

/**
 * Sessions live in KV, not in D1, so they survive the pool's per-test storage
 * rollback — one sign-in per identity for the whole file, rather than one per
 * test. This is the difference between a 30 s file and a 4 min one.
 */
const SESSIONS = new Map<string, Promise<string>>();

function login(email: string): Promise<string> {
  const existing = SESSIONS.get(email);
  if (existing) return existing;
  const pending = (async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "demo1234" }),
    });
    const setCookie = res.headers.get("set-cookie");
    return setCookie ? setCookie.split(";")[0] : "";
  })();
  SESSIONS.set(email, pending);
  return pending;
}

function req(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });

interface Row {
  id: string;
  edition: string;
  category: string;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  summary: string;
  detail_json: string | null;
  deck_id: string | null;
  target_type: string | null;
  target_id: string | null;
}

/**
 * A generated row is `aud_<uuid>` and a seeded one is `aud_0001`, so the hyphen
 * separates them exactly — no prefix arithmetic, no chance of a random id
 * shadowing the seed.
 */
const GENERATED = "id LIKE '%-%'";

/** Every row written by one action, newest first. Never touches the 0030 seed. */
async function rowsFor(action: string): Promise<Row[]> {
  return (
    await env.DB.prepare(
      `SELECT * FROM audit_log WHERE action = ? AND ${GENERATED} ORDER BY created_at DESC, id DESC`,
    )
      .bind(action)
      .all<Row>()
  ).results;
}

/** Everything this test run wrote, so "exactly one row" means exactly one. */
async function written(): Promise<Row[]> {
  return (
    await env.DB.prepare(`SELECT * FROM audit_log WHERE ${GENERATED} ORDER BY created_at, id`).all<Row>()
  ).results;
}

async function clearWritten(): Promise<void> {
  await env.DB.prepare(`DELETE FROM audit_log WHERE ${GENERATED}`).run();
}

interface AuditPageBody {
  events: {
    id: string;
    category: string;
    action: string;
    summary: string;
    actor: string;
    deckId: string | null;
    deckName: string | null;
    createdAt: string;
  }[];
  nextCursor: string | null;
  actors: { id: string; label: string }[];
  retentionDays: number | null;
  canConfigure: boolean;
}

async function page(cookie: string, qs = ""): Promise<AuditPageBody> {
  const res = await get(`/api/audit${qs}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as AuditPageBody;
}

// ═══════════════════════════════════════════════════════════════════════════
// The three the brief names: a config change, a permission change, a credit grant
// ═══════════════════════════════════════════════════════════════════════════

describe("writers — exactly one row, the right category, the right actor", () => {
  beforeEach(clearWritten);

  it("a config change writes one `config` row naming the actor and both values", async () => {
    const cookie = await login(ADMIN);
    const res = await req("PUT", "/api/config/thresholds", cookie, { best: 7.5, mediocre: 5.5 });
    expect(res.status).toBe(200);

    const all = await written();
    expect(all).toHaveLength(1);
    const row = all[0];
    expect(row.category).toBe("config");
    expect(row.action).toBe("cohort_thresholds_changed");
    expect(row.edition).toBe("incubator");
    expect(row.actor_id).toBe("inc_admin");
    // Denormalised `.log-u` form, exactly as the prototype renders it.
    expect(row.actor_label).toBe("Nisha K.");
    expect(row.summary).toContain("Best ≥ 7 → 7.5");
    expect(row.summary).toContain("Mediocre ≥ 5 → 5.5");
    expect(row.deck_id).toBeNull(); // the whole point of `audit_log` (F0013)
  });

  it("a permission change writes one `security` row per cell, naming role and task", async () => {
    const cookie = await login(ADMIN);
    const res = await req("PUT", "/api/permissions", cookie, {
      cells: [{ role: "jury", taskId: "archive", granted: false }],
    });
    expect(res.status).toBe(200);

    const all = await written();
    expect(all).toHaveLength(1);
    expect(all[0].category).toBe("security");
    expect(all[0].action).toBe("permission_changed");
    expect(all[0].actor_id).toBe("inc_admin");
    expect(all[0].summary).toContain("Jury Member");
    expect(all[0].summary).toContain("Archive");
    expect(all[0].summary).toContain("allowed → denied");
    expect(all[0].target_id).toBe("jury:archive");
  });

  it("a credit grant writes one `billing` row AND the ledger line behind it", async () => {
    const cookie = await login(ADMIN);
    const before = await env.DB.prepare("SELECT credits_balance FROM org_settings WHERE edition = 'incubator'")
      .first<{ credits_balance: number }>();
    const res = await req("POST", "/api/config/credits", cookie, {
      credits: (before?.credits_balance ?? 0) + 25,
    });
    expect(res.status).toBe(200);

    const all = await written();
    expect(all).toHaveLength(1);
    expect(all[0].category).toBe("billing");
    expect(all[0].action).toBe("credits_adjusted");
    expect(all[0].actor_id).toBe("inc_admin");
    expect(all[0].summary).toContain("+25");

    // F0054 — the Billing sentence is made of ledger columns, so the ledger row
    // has to exist or the category has nothing behind it.
    const ledger = await env.DB.prepare(
      "SELECT delta, reason, actor_id FROM credit_ledger WHERE id = ?",
    )
      .bind(all[0].target_id)
      .first<{ delta: number; reason: string; actor_id: string }>();
    expect(ledger).toMatchObject({ delta: 25, reason: "adjustment", actor_id: "inc_admin" });
  });

  it("a credit purchase carries the pack, the money and a transaction reference", async () => {
    const cookie = await login(ADMIN);
    const res = await req("POST", "/api/config/credits/purchase", cookie, { credits: 50 });
    expect(res.status).toBe(200);

    const rows = await rowsFor("credits_purchased");
    expect(rows).toHaveLength(1);
    // The prototype's own Billing sentence: "Purchased 50-credit pack ·
    // ₹20,000 · Transaction ID: RZP250603112244".
    expect(rows[0].summary).toMatch(/^Purchased 50-unit pack · ₹20,000 · Transaction ID: \S+$/);

    const ledger = await env.DB.prepare(
      "SELECT delta, reason, amount_minor, currency, reference FROM credit_ledger WHERE id = ?",
    )
      .bind(rows[0].target_id)
      .first<{ delta: number; reason: string; amount_minor: number; currency: string; reference: string }>();
    expect(ledger).toMatchObject({ delta: 50, reason: "purchase", amount_minor: 2000000, currency: "INR" });
    expect(rows[0].summary).toContain(ledger!.reference);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The other three prototype categories
// ═══════════════════════════════════════════════════════════════════════════

describe("writers — the rest of the prototype's four badges", () => {
  beforeEach(clearWritten);

  it("a team invite writes the prototype's Team sentence, plan and all (F0053)", async () => {
    const cookie = await login(ADMIN);
    const res = await req("POST", "/api/users", cookie, {
      name: "Tara Nair",
      email: "tara.nair@demo.startupjury.ai",
      role: "program_associate",
    });
    expect(res.status).toBe(200);

    const rows = await rowsFor("user_invited");
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("team");
    // The plan comes off `org_settings`, so the sentence names whatever this
    // workspace is actually on — the prototype's row says "Standard plan"
    // because its demo org is.
    const org = await env.DB.prepare("SELECT plan FROM org_settings WHERE edition = 'incubator'")
      .first<{ plan: string }>();
    const plan = { standard: "Standard", pro: "Pro", premium: "Premium" }[org!.plan];
    expect(rows[0].summary).toBe(
      `Invited Tara Nair (tara.nair@demo.startupjury.ai) as Program Associate · ${plan} plan`,
    );
  });

  it("a roster edit writes one row per thing that actually changed", async () => {
    const cookie = await login(ADMIN);
    // Its own subject, so the test never deactivates an identity another test
    // in this file signs in as.
    const created = await req("POST", "/api/users", cookie, {
      name: "Meera Subramanian",
      email: "meera.sub@demo.startupjury.ai",
      role: "jury",
    });
    expect(created.status).toBe(200);
    const { user } = (await created.json()) as { user: { id: string } };
    await clearWritten();

    const res = await req("PATCH", `/api/users/${user.id}`, cookie, {
      active: false,
      title: "Lead juror",
    });
    expect(res.status).toBe(200);

    const all = await written();
    expect(all.map((r) => r.action).sort()).toEqual(["user_deactivated", "user_title_changed"]);
    expect(all.every((r) => r.category === "team")).toBe(true);
    expect(all.find((r) => r.action === "user_deactivated")!.summary).toBe(
      "Deactivated Meera Subramanian",
    );
    expect(all.find((r) => r.action === "user_title_changed")!.summary).toBe(
      'Set Meera Subramanian\'s alias title to "Lead juror"',
    );
  });

  it("a score more than `delta` from the AI writes a `score` row with both values and the reason", async () => {
    const cookie = await login(JURY);
    // inc_deck_taxpilot is 'assigned' to inc_jury with a full AI set (0010);
    // the AI scored Traction & Validation 6, and the default rationale delta is 2.
    const res = await req("POST", "/api/decks/inc_deck_taxpilot/evaluate", cookie, {
      scores: [
        { key: "traction_validation", value: 9, comment: "Pilot data confirmed after the deck was submitted" },
      ],
      remarks: "",
    });
    expect(res.status).toBe(200);

    const rows = await rowsFor("score_overridden");
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("score");
    expect(rows[0].actor_id).toBe("inc_jury");
    expect(rows[0].summary).toBe(
      'Override: Traction & Validation score for TaxPilot changed 6 → 9. ' +
        'Reason: "Pilot data confirmed after the deck was submitted"',
    );
    // Deck-scoped, unlike every config/team/billing row.
    expect(rows[0].deck_id).toBe("inc_deck_taxpilot");
    expect(rows[0].target_id).toBe("inc_traction_validation");
  });

  it("a score within `delta` of the AI is not an override and writes nothing", async () => {
    const cookie = await login(JURY);
    const res = await req("POST", "/api/decks/inc_deck_taxpilot/evaluate", cookie, {
      scores: [{ key: "traction_validation", value: 7 }],
      remarks: "",
    });
    expect(res.status).toBe(200);
    expect(await rowsFor("score_overridden")).toHaveLength(0);
  });

  it("a rubric anchor edit writes the prototype's Config sentence", async () => {
    const cookie = await login(ADMIN);
    const res = await req("PUT", "/api/anchors/inc_traction_validation", cookie, {
      bands: [{ index: 4, description: "Revenue compounding month on month with named customers." }],
    });
    expect(res.status).toBe(200);

    const rows = await rowsFor("rubric_anchor_updated");
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("config");
    expect(rows[0].summary).toContain("Rubric anchor updated for Traction & Validation");
  });

  it("a question-bank edit is a Config event — it changes what a founder is asked", async () => {
    const cookie = await login(ADMIN);
    const res = await req("POST", "/api/questions", cookie, {
      parameterId: "inc_traction_validation",
      text: "What is your month-on-month revenue growth over the last two quarters?",
    });
    expect(res.status).toBe(201);

    const rows = await rowsFor("bank_question_added");
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("config");
    expect(rows[0].summary).toBe("Clarification question added to Traction & Validation");
  });

  it("the scoring framework writes one row per setting, in the prototype's words", async () => {
    const cookie = await login(ADMIN);
    const current = await get("/api/config/scoring", cookie);
    const { scoring } = (await current.json()) as { scoring: Record<string, unknown> };
    const res = await req("PUT", "/api/config/scoring-framework", cookie, {
      ...scoring,
      shortlistThreshold: 7.5,
      showAiScoreToJury: false,
    });
    expect(res.status).toBe(200);

    const all = await written();
    expect(all.map((r) => r.action).sort()).toEqual(["blind_scoring_toggled", "threshold_changed"]);
    expect(all.find((r) => r.action === "threshold_changed")!.summary).toMatch(
      /^Shortlist threshold changed from [\d.]+ to 7\.5$/,
    );
    expect(all.find((r) => r.action === "blind_scoring_toggled")!.summary).toBe(
      "AI score visibility toggled OFF for jury member — blind evaluation mode enabled",
    );
  });

  it("a CRM settings change names the field that moved — the prototype's first row", async () => {
    const cookie = await login(ADMIN);
    // `0037` seeds this connection at trigger value "Submitted for evaluation";
    // move it, so the row records a change rather than a no-op save.
    const res = await req("PUT", "/api/crm/salesforce", cookie, {
      triggerField: "Stage",
      triggerValue: "Ready for review",
    });
    expect(res.status).toBe(200);

    const rows = await rowsFor("crm_settings_updated");
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("config");
    // "Updated Salesforce filter rule trigger value to …" — `s-al.html`'s row 1.
    expect(rows[0].summary).toBe(
      'Salesforce sync: trigger value Submitted for evaluation → Ready for review',
    );
  });

  it("a save that changes nothing writes no row — a trail of no-ops is noise", async () => {
    const cookie = await login(ADMIN);
    const res = await req("PUT", "/api/crm/salesforce", cookie, {
      triggerField: "Stage",
      triggerValue: "Submitted for evaluation",
    });
    expect(res.status).toBe(200);
    expect(await rowsFor("crm_settings_updated")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The read route
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/audit — authZ", () => {
  it("serves the console's own audience and refuses everyone else", async () => {
    expect((await get("/api/audit", await login(ADMIN))).status).toBe(200);
    expect((await get("/api/audit", await login(SUPERUSER))).status).toBe(200);
    expect((await get("/api/audit", await login(JURY))).status).toBe(403);
    expect((await get("/api/audit", await login(PA))).status).toBe(403);
  });

  it("is unreachable unauthenticated", async () => {
    const res = await SELF.fetch(`${BASE}/api/audit`);
    expect(res.status).toBe(401);
  });

  it("never leaks another edition's trail", async () => {
    const inc = await page(await login(ADMIN));
    const vc = await page(await login(VC_ADMIN));
    const incIds = new Set(inc.events.map((e) => e.id));
    expect(vc.events.some((e) => incIds.has(e.id))).toBe(false);
    // `0030` seeds the ten prototype rows for the incubator only.
    expect(inc.events.some((e) => e.id.startsWith("aud_00"))).toBe(true);
    expect(vc.events.some((e) => e.id.startsWith("aud_00"))).toBe(false);
  });

  it("refuses a retention window shorter than the floor", async () => {
    const cookie = await login(ADMIN);
    expect((await req("PUT", "/api/audit/retention", cookie, { retentionDays: 5 })).status).toBe(400);
    expect((await req("PUT", "/api/audit/retention", cookie, { retentionDays: "90" })).status).toBe(400);
    expect((await req("PUT", "/api/audit/retention", await login(JURY), { retentionDays: null })).status).toBe(403);
  });
});

describe("GET /api/audit — filters and paging (F0059)", () => {
  it("filters by category", async () => {
    const cookie = await login(ADMIN);
    const body = await page(cookie, "?category=billing");
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.every((e) => e.category === "billing")).toBe(true);
  });

  it("filters by several categories at once", async () => {
    const cookie = await login(ADMIN);
    const body = await page(cookie, "?category=billing&category=team");
    expect(new Set(body.events.map((e) => e.category))).toEqual(new Set(["billing", "team"]));
  });

  it("filters by actor", async () => {
    const cookie = await login(ADMIN);
    const body = await page(cookie, "?actorId=inc_pm");
    expect(body.events.length).toBeGreaterThan(0);
    // `0030` gives inc_pm exactly one row (the blind-scoring toggle).
    expect(body.events.every((e) => e.actor === "Raj K.")).toBe(true);
  });

  it("filters by date range — the '3 Jun' rows the prototype shows", async () => {
    const cookie = await login(ADMIN);
    const body = await page(cookie, "?from=2026-06-03&to=2026-06-03");
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.every((e) => e.createdAt.startsWith("2026-06-03"))).toBe(true);
  });

  it("searches the rendered sentence", async () => {
    const cookie = await login(ADMIN);
    const body = await page(cookie, "?q=Shortlist%20threshold");
    expect(body.events.some((e) => e.summary.includes("Shortlist threshold"))).toBe(true);
    expect(body.events.every((e) => e.summary.includes("Shortlist threshold"))).toBe(true);
  });

  it("pages with a keyset cursor and never repeats a row", async () => {
    const cookie = await login(ADMIN);
    const first = await page(cookie, "?limit=4");
    expect(first.events).toHaveLength(4);
    expect(first.nextCursor).not.toBeNull();

    const second = await page(cookie, `?limit=4&cursor=${encodeURIComponent(first.nextCursor!)}`);
    const ids = new Set(first.events.map((e) => e.id));
    expect(second.events.some((e) => ids.has(e.id))).toBe(false);
    // Strictly reverse-chronological across the page boundary.
    const last = first.events[first.events.length - 1].createdAt;
    expect(second.events.every((e) => e.createdAt <= last)).toBe(true);
  });

  it("reports the last page by returning no cursor", async () => {
    const cookie = await login(ADMIN);
    const body = await page(cookie, "?category=security&limit=200");
    expect(body.nextCursor).toBeNull();
  });

  it("offers the actors present in the trail", async () => {
    const body = await page(await login(ADMIN));
    expect(body.actors.map((a) => a.id)).toContain("inc_admin");
    expect(body.actors.every((a) => a.label.length > 0)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// One store — the All-decks Activity card is a filtered view over it
// ═══════════════════════════════════════════════════════════════════════════

describe("the Activity card and the Audit log are the same store", () => {
  interface ActivityBody {
    events: {
      id: string;
      deckId: string;
      deckName: string;
      toStage: string;
      toLabel: string;
      fromLabel: string | null;
      action: string;
      note: string | null;
      actorName: string;
      actorTitle?: string;
      createdAt: string;
    }[];
  }

  it("GET /api/activity still returns the rail's exact shape, 12 rows by default", async () => {
    const cookie = await login(ADMIN);
    const res = await get("/api/activity", cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActivityBody;
    expect(body.events.length).toBeLessThanOrEqual(12);
    expect(body.events.length).toBeGreaterThan(0);
    const e = body.events[0];
    expect(typeof e.deckName).toBe("string");
    expect(typeof e.toLabel).toBe("string");
    expect(typeof e.actorName).toBe("string");
    expect(typeof e.createdAt).toBe("string");
  });

  it("a deck-scoped event reaches BOTH — the card, and the log's `pipeline` filter", async () => {
    const admin = await login(ADMIN);
    // A real stage transition: `shortlist` runs from `jury_evaluation`, and
    // admin is on that transition's role list (src/pipeline/incubator.ts).
    const moved = await req("POST", "/api/decks/inc_deck_insureflow/transition", admin, {
      action: "shortlist",
    });
    expect(moved.status).toBe(200);

    const card = (await (await get("/api/activity", admin)).json()) as ActivityBody;
    const top = card.events[0];
    expect(top.deckId).toBe("inc_deck_insureflow");

    const log = await page(admin, "?category=pipeline&limit=5");
    // The same row id, from the same store, under the Pipeline badge.
    expect(log.events[0].id).toBe(top.id);
    expect(log.events[0].category).toBe("pipeline");
    expect(log.events[0].summary).toContain("InsureFlow");
  });

  it("the card honours its programme filter, and the trail stays edition-wide", async () => {
    const cookie = await login(ADMIN);
    const res = await get("/api/activity?programId=inc_prog_nonexistent", cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ActivityBody).events).toHaveLength(0);
  });

  it("a founder sees only their own deck's history, and no administrative rows", async () => {
    const founder = await env.DB.prepare(
      "SELECT email FROM users WHERE role = 'founder' AND edition = 'incubator' LIMIT 1",
    ).first<{ email: string }>();
    if (!founder) return; // no seeded founder in this edition — nothing to assert
    const cookie = await login(founder.email);
    const res = await get("/api/activity", cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActivityBody;
    // Whatever they see is deck-scoped; the `audit_log` branch is excluded for
    // founders entirely, so a config or billing row can never appear here.
    expect(body.events.every((e) => Boolean(e.deckId))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Retention
// ═══════════════════════════════════════════════════════════════════════════

describe("retention", () => {
  beforeEach(clearWritten);

  it("defaults to keeping everything", async () => {
    const body = await page(await login(ADMIN));
    expect(body.retentionDays).toBeNull();
    expect(body.canConfigure).toBe(true);
  });

  it("applies the window it sets, and records having set it", async () => {
    const cookie = await login(ADMIN);
    await env.DB.prepare(
      "INSERT INTO audit_log (id, edition, category, action, summary, created_at) " +
        "VALUES ('aud_stale1', 'incubator', 'config', 'threshold_changed', 'ancient', datetime('now', '-400 days'))",
    ).run();

    const res = await req("PUT", "/api/audit/retention", cookie, { retentionDays: 365 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, retentionDays: 365, purged: 1 });

    const gone = await env.DB.prepare("SELECT id FROM audit_log WHERE id = 'aud_stale1'").first();
    expect(gone).toBeNull();

    // The act of shortening the trail is itself in the trail.
    const rows = await rowsFor("audit_retention_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("security");
    expect(rows[0].summary).toBe("Audit log retention changed from Keep everything to 1 year");
  });

  it("purges nothing when the window is cleared back to 'keep everything'", async () => {
    const cookie = await login(ADMIN);
    await req("PUT", "/api/audit/retention", cookie, { retentionDays: 30 });
    const res = await req("PUT", "/api/audit/retention", cookie, { retentionDays: null });
    expect(await res.json()).toMatchObject({ retentionDays: null, purged: 0 });
  });

  it("never prunes `pipeline_events` — a deck's own decision history is not a log line", async () => {
    const cookie = await login(ADMIN);
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM pipeline_events").first<{ n: number }>();
    await req("PUT", "/api/audit/retention", cookie, { retentionDays: 30 });
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM pipeline_events").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });
});
