import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Env } from "../../src/server/types";
import { emitNotification } from "../../src/server/email/outbox";
import { reserveCredits } from "../../src/server/decks/versions";
import { recordSyncAttempt } from "../../src/server/crm/provider";
import { evaluateDeck, type RawEvaluation } from "../../src/server/ai/evaluate";
import { runMonthlyUsageSummary, previousMonth } from "../../src/server/scheduled";
import {
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  type NotificationPreferenceView,
} from "../../src/shared/notifications";

/**
 * W3-B — Admin console → System → Notifications (`/api/notifications`), the
 * preference model, and the ten producers.
 *
 * Four things this suite exists to hold:
 *
 *  1. **A toggle governs an outbox row.** For every one of the ten events:
 *     exactly ONE `email_outbox` row for a given recipient when their
 *     preference is on, and NONE when it is off. That, not the presence of a
 *     checkbox, is what says the preference model is wired to the send path.
 *  2. **Nine producers exist at real call sites.** Each is driven through the
 *     actual route or function that performs the thing — an upload, an
 *     evaluation, a score submission, a schedule, a credit spend, a sync
 *     failure, a first sign-in, a cron — not by calling the emitter.
 *  3. **AuthZ.** The per-user scope is any authenticated non-mentor role; the
 *     workspace policy and the delivery log are admin + `adminconsole`.
 *  4. **Preferences round-trip per edition** — the incubator's default and the
 *     VC's are separate rows and must not bleed.
 *
 * NB worker-test storage is isolated per FILE, not per test: writes accumulate
 * across the `it`s below, so every fixture uses a distinct deck / user / key
 * and every assertion counts rows for its own recipient rather than in total.
 */

const BASE = "https://example.com";

// Seed logins (migrations/0002_seed.sql, 0015_roles_users.sql).
const INC_ADMIN_EMAIL = "nisha.kapoor@demo.startupjury.ai";
const INC_PM = "raj.kumar@demo.startupjury.ai";
const INC_PA = "sunita.rao@demo.startupjury.ai";
const INC_JURY = "rajesh.kumar@demo.startupjury.ai";
const INC_MENTOR = "anil.mehta@demo.startupjury.ai";
const VC_ADMIN_EMAIL = "nisha.kapoor.vc@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });

function send(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const put = (p: string, c: string, b?: unknown) => send("PUT", p, c, b);
const post = (p: string, c: string, b?: unknown) => send("POST", p, c, b);
const del = (p: string, c: string) => send("DELETE", p, c);

const E = () => env as unknown as Env;

/** Outbox rows of one alert kind addressed to one recipient. */
async function alertsTo(event: NotificationEvent, email: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM email_outbox WHERE kind = ? AND to_email = ?",
  )
    .bind(`alert_${event}`, email)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** In-app rows of one event for one user. */
async function bellRowsFor(event: NotificationEvent, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notifications WHERE event_key = ? AND user_id = ?",
  )
    .bind(event, userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Force the workspace default for one event × channel, bypassing the API. */
async function setDefault(
  edition: string,
  event: NotificationEvent,
  channel: "email" | "in_app",
  enabled: boolean,
): Promise<void> {
  const res = await env.DB.prepare(
    "UPDATE notification_preferences SET enabled = ? WHERE edition = ? AND event_key = ? AND channel = ? AND user_id IS NULL",
  )
    .bind(enabled ? 1 : 0, edition, event, channel)
    .run();
  if (res.meta.changes === 0) {
    await env.DB.prepare(
      "INSERT INTO notification_preferences (id, edition, user_id, event_key, channel, enabled) VALUES (?, ?, NULL, ?, ?, ?)",
    )
      .bind(`np_t_${edition}_${event}_${channel}`, edition, event, channel, enabled ? 1 : 0)
      .run();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. A toggle governs an outbox row — for all ten events.
// ─────────────────────────────────────────────────────────────────────────────

describe("preference → outbox, for every one of the ten events", () => {
  // The incubator admin is in every event's audience, so one probe recipient
  // covers the whole vocabulary.
  const probe = INC_ADMIN_EMAIL;

  it.each(NOTIFICATION_EVENTS)(
    "%s: none when the toggle is off, exactly one when it is on",
    async (event) => {
      // OFF — including the in-app channel, so the bell is checked too.
      await setDefault("incubator", event, "email", false);
      await setDefault("incubator", event, "in_app", false);
      await emitNotification(E(), {
        event,
        edition: "incubator",
        title: `off ${event}`,
        dedupeKey: `t_off_${event}`,
      });
      expect(await alertsTo(event, probe), `${event} sent while disabled`).toBe(0);
      expect(await bellRowsFor(event, "inc_admin")).toBe(0);

      // ON.
      await setDefault("incubator", event, "email", true);
      await setDefault("incubator", event, "in_app", true);
      const result = await emitNotification(E(), {
        event,
        edition: "incubator",
        title: `on ${event}`,
        dedupeKey: `t_on_${event}`,
      });
      expect(result.recipients).toBeGreaterThan(0);
      expect(await alertsTo(event, probe), `${event} produced no row`).toBe(1);
      expect(await bellRowsFor(event, "inc_admin")).toBe(1);

      // And a re-run of the same keyed event adds nothing (idempotence is what
      // lets a producer sit inside a retried pipeline action).
      await emitNotification(E(), {
        event,
        edition: "incubator",
        title: `on ${event}`,
        dedupeKey: `t_on_${event}`,
      });
      expect(await alertsTo(event, probe)).toBe(1);
      expect(await bellRowsFor(event, "inc_admin")).toBe(1);
    },
  );

  it("a user's own row overrides the workspace default", async () => {
    const event: NotificationEvent = "deck_submitted";
    await setDefault("incubator", event, "email", true);
    await env.DB.prepare(
      "INSERT INTO notification_preferences (id, edition, user_id, event_key, channel, enabled) VALUES (?, 'incubator', 'inc_pm', ?, 'email', 0)",
    )
      .bind(`np_ovr_${event}`, event)
      .run();

    const before = await alertsTo(event, INC_PM);
    await emitNotification(E(), {
      event,
      edition: "incubator",
      title: "override check",
      dedupeKey: "t_override",
    });
    // The admin (default ON) heard it; the PM (own row OFF) did not.
    expect(await alertsTo(event, INC_PM)).toBe(before);
    expect(await alertsTo(event, INC_ADMIN_EMAIL)).toBeGreaterThan(0);

    await env.DB.prepare("DELETE FROM notification_preferences WHERE id = ?")
      .bind(`np_ovr_${event}`)
      .run();
  });

  it("never notifies the actor about their own action, or a mentor", async () => {
    await setDefault("incubator", "founder_responded", "email", true);
    // Relative: the table-driven block above has already produced one row of
    // this kind for the admin, and storage is isolated per FILE, not per test.
    const adminBefore = await alertsTo("founder_responded", INC_ADMIN_EMAIL);
    const mentorBefore = await alertsTo("founder_responded", INC_MENTOR);
    const result = await emitNotification(E(), {
      event: "founder_responded",
      edition: "incubator",
      title: "actor exclusion",
      actorId: "inc_admin",
      // A mentor named explicitly is still refused — it holds no screens.
      alsoNotify: ["inc_mentor"],
      dedupeKey: "t_actor",
    });
    expect(await alertsTo("founder_responded", INC_ADMIN_EMAIL)).toBe(adminBefore);
    expect(await alertsTo("founder_responded", INC_MENTOR)).toBe(mentorBefore);
    expect(result.recipients).toBeGreaterThan(0);
  });

  it("records rather than sends while no sending domain is verified (§1.4)", async () => {
    const row = await env.DB.prepare(
      "SELECT status FROM email_outbox WHERE kind = 'alert_credits_low' LIMIT 1",
    ).first<{ status: string }>();
    expect(row?.status).toBe("recorded");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The nine missing producers, driven through their real call sites.
// ─────────────────────────────────────────────────────────────────────────────

const OK_EVAL: RawEvaluation = {
  startup_name: "Producer Co",
  complete: true,
  founder: "Ada Founder",
  founder_email: "ada@producer.example",
  founder_phone: "+91 90000 00000",
  city: "Bengaluru",
  sector: "Fintech",
  scores: [],
};

function pdf(name: string): File {
  return new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });
}

describe("producers", () => {
  it("deck_submitted — POST /api/decks/upload", async () => {
    await setDefault("incubator", "deck_submitted", "email", true);
    const cookie = await login(INC_PA);
    const form = new FormData();
    form.set("file", pdf("producer-one.pdf"));
    form.set("name", "ProducerOne");
    const before = await alertsTo("deck_submitted", INC_ADMIN_EMAIL);
    await SELF.fetch(`${BASE}/api/decks/upload`, { method: "POST", headers: { cookie }, body: form });
    expect(await alertsTo("deck_submitted", INC_ADMIN_EMAIL)).toBe(before + 1);
  });

  it("ai_scoring_complete — evaluateDeck, once per content version", async () => {
    await setDefault("incubator", "ai_scoring_complete", "email", true);
    await env.DB.prepare(
      "INSERT INTO decks (id, edition, name, status, r2_key, content_version, complete, uploaded_by) " +
        "VALUES ('ntf_ai', 'incubator', 'AiAlert', 'pending_ai', 'decks/ntf_ai.pdf', 1, 1, 'inc_pa')",
    ).run();
    await env.DECKS.put("decks/ntf_ai.pdf", new Uint8Array([37, 80, 68, 70]));

    const before = await alertsTo("ai_scoring_complete", INC_ADMIN_EMAIL);
    const call = async () => OK_EVAL;
    await evaluateDeck(E(), "ntf_ai", { callModel: call });
    expect(await alertsTo("ai_scoring_complete", INC_ADMIN_EMAIL)).toBe(before + 1);
    // A re-score of the SAME version is the same result — no second alert.
    await evaluateDeck(E(), "ntf_ai", { callModel: call });
    expect(await alertsTo("ai_scoring_complete", INC_ADMIN_EMAIL)).toBe(before + 1);
  });

  it("evaluator_scores_submitted + all_evaluations_complete — POST /decks/:id/evaluate", async () => {
    await setDefault("incubator", "evaluator_scores_submitted", "email", true);
    await setDefault("incubator", "all_evaluations_complete", "email", true);
    await env.DB.prepare(
      "INSERT INTO decks (id, edition, name, status, assigned_to, complete, uploaded_by) " +
        "VALUES ('ntf_scored', 'incubator', 'ScoreAlert', 'assigned', 'inc_jury', 1, 'inc_pa')",
    ).run();

    const submittedBefore = await alertsTo("evaluator_scores_submitted", INC_PM);
    const completeBefore = await alertsTo("all_evaluations_complete", INC_PM);
    const juryBefore = await alertsTo("evaluator_scores_submitted", INC_JURY);

    const keys = (
      await env.DB.prepare(
        "SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 AND informational = 0 ORDER BY sort_order LIMIT 3",
      ).all<{ key: string }>()
    ).results.map((r) => r.key);

    const jury = await login(INC_JURY);
    const res = await post("/api/decks/ntf_scored/evaluate", jury, {
      scores: keys.map((key) => ({ key, value: 7, comment: "fine" })),
      remarks: "done",
    });
    expect(res.status).toBe(200);

    // The PM is the decision maker and hears both; the jury member who
    // submitted is the actor and hears neither.
    expect(await alertsTo("evaluator_scores_submitted", INC_PM)).toBe(submittedBefore + 1);
    expect(await alertsTo("all_evaluations_complete", INC_PM)).toBe(completeBefore + 1);
    expect(await alertsTo("evaluator_scores_submitted", INC_JURY)).toBe(juryBefore);

    // An idempotent re-submit re-scores without re-alerting.
    await post("/api/decks/ntf_scored/evaluate", jury, {
      scores: keys.map((key) => ({ key, value: 8, comment: "revised" })),
      remarks: "again",
    });
    expect(await alertsTo("evaluator_scores_submitted", INC_PM)).toBe(submittedBefore + 1);
    expect(await alertsTo("all_evaluations_complete", INC_PM)).toBe(completeBefore + 1);
  });

  it("founder_responded — POST /api/queries/:id/respond", async () => {
    await setDefault("incubator", "founder_responded", "email", true);
    await env.DB.prepare(
      "INSERT INTO decks (id, edition, name, status, complete, uploaded_by) " +
        "VALUES ('ntf_query', 'incubator', 'QueryAlert', 'incomplete', 0, 'inc_founder')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO queries (id, deck_id, questions, email_status) VALUES ('ntf_q1', 'ntf_query', 'What is the traction?', 'sent')",
    ).run();

    const actorBefore = await alertsTo("founder_responded", INC_PA);
    const pmBefore = await alertsTo("founder_responded", INC_PM);
    const pa = await login(INC_PA);
    const res = await post("/api/queries/ntf_q1/respond", pa, { response: "300 paying users." });
    expect(res.status).toBe(200);
    // The PA relayed it, so the PA is the actor and hears nothing.
    expect(await alertsTo("founder_responded", INC_PA)).toBe(actorBefore);
    expect(await alertsTo("founder_responded", INC_PM)).toBe(pmBefore + 1);
  });

  it("intro_call_scheduled — POST /api/calls, and again on a genuine reschedule", async () => {
    await setDefault("incubator", "intro_call_scheduled", "email", true);
    await env.DB.prepare(
      "INSERT INTO decks (id, edition, name, status, complete, uploaded_by) " +
        "VALUES ('ntf_call', 'incubator', 'CallAlert', 'shortlisted', 1, 'inc_pa')",
    ).run();

    const before = await alertsTo("intro_call_scheduled", INC_PM);
    const pa = await login(INC_PA);
    const created = await post("/api/calls", pa, {
      deckId: "ntf_call",
      kind: "intro",
      scheduledAt: "2026-10-01T10:00:00.000Z",
      durationMinutes: 30,
    });
    expect(created.status).toBe(200);
    const { call } = (await created.json()) as { call: { id: string } };
    expect(await alertsTo("intro_call_scheduled", INC_PM)).toBe(before + 1);

    // Editing the title is neither "scheduled" nor "rescheduled".
    await send("PATCH", `/api/calls/${call.id}`, pa, { title: "Renamed" });
    expect(await alertsTo("intro_call_scheduled", INC_PM)).toBe(before + 1);

    // Moving the slot is.
    await send("PATCH", `/api/calls/${call.id}`, pa, {
      scheduledAt: "2026-10-02T10:00:00.000Z",
    });
    expect(await alertsTo("intro_call_scheduled", INC_PM)).toBe(before + 2);
  });

  it("credits_low — reserveCredits, on the crossing only", async () => {
    await setDefault("vc", "credits_low", "email", true);
    await env.DB.prepare("UPDATE org_settings SET credits_balance = 11 WHERE edition = 'vc'").run();

    const before = await alertsTo("credits_low", VC_ADMIN_EMAIL);

    // 11 → 10 is still at the line, not under it.
    expect(await reserveCredits(E(), "vc", 1)).toBe(true);
    expect(await alertsTo("credits_low", VC_ADMIN_EMAIL)).toBe(before);

    // 10 → 9 crosses.
    expect(await reserveCredits(E(), "vc", 1)).toBe(true);
    expect(await alertsTo("credits_low", VC_ADMIN_EMAIL)).toBe(before + 1);

    // 9 → 8 is below the line but is not a crossing: no second warning.
    expect(await reserveCredits(E(), "vc", 1)).toBe(true);
    expect(await alertsTo("credits_low", VC_ADMIN_EMAIL)).toBe(before + 1);
  });

  it("crm_sync_failed — recordSyncAttempt, when the adapter throws", async () => {
    await setDefault("vc", "crm_sync_failed", "email", true);
    const before = await alertsTo("crm_sync_failed", VC_ADMIN_EMAIL);

    const record = await recordSyncAttempt(
      E(),
      {
        connectionId: "crm_vc_salesforce",
        edition: "vc",
        provider: "salesforce",
        operation: "pull_deals",
        direction: "pull",
        recordCount: 0,
        payload: { limit: 10 },
      },
      { credentialRef: null },
      undefined,
      {
        provider: "salesforce",
        pullDeals: async () => {
          throw new Error("upstream 503");
        },
        writeBack: async () => undefined,
      },
    );
    expect(record.status).toBe("failed");
    expect(await alertsTo("crm_sync_failed", VC_ADMIN_EMAIL)).toBe(before + 1);

    // A 'recorded' attempt (no adapter — the §1.3 default) is not a failure.
    await recordSyncAttempt(
      E(),
      {
        connectionId: "crm_vc_salesforce",
        edition: "vc",
        provider: "salesforce",
        operation: "pull_deals",
        direction: "pull",
        recordCount: 0,
        payload: { limit: 10 },
      },
      { credentialRef: null },
    );
    expect(await alertsTo("crm_sync_failed", VC_ADMIN_EMAIL)).toBe(before + 1);
  });

  it("invite_accepted — the invitee's first sign-in, and never their second", async () => {
    await setDefault("incubator", "invite_accepted", "email", true);
    // A user created the way `POST /api/users` creates one, with the invite
    // still outstanding.
    await env.DB.prepare(
      "INSERT INTO users (id, name, email, password_hash, role, edition, initials, invite_accepted_at) " +
        "VALUES ('ntf_invitee', 'Newly Invited', 'newly.invited@demo.startupjury.ai', " +
        "'pbkdf2$100000$WZJYdAIVAjK8mx0Ac0g+WA==$sf3KrNCz3DIODrtWC5mgxMf9SA2gY2b6Mbq7B9l5R2Y=', " +
        "'jury', 'incubator', 'NI', NULL)",
    ).run();

    const before = await alertsTo("invite_accepted", INC_ADMIN_EMAIL);
    await login("newly.invited@demo.startupjury.ai");
    expect(await alertsTo("invite_accepted", INC_ADMIN_EMAIL)).toBe(before + 1);

    const stamped = await env.DB.prepare(
      "SELECT invite_accepted_at FROM users WHERE id = 'ntf_invitee'",
    ).first<{ invite_accepted_at: string | null }>();
    expect(stamped?.invite_accepted_at).toBeTruthy();

    await login("newly.invited@demo.startupjury.ai");
    expect(await alertsTo("invite_accepted", INC_ADMIN_EMAIL)).toBe(before + 1);
  });

  it("a seeded demo login never fires invite_accepted (0041 backfills them)", async () => {
    const before = await alertsTo("invite_accepted", VC_ADMIN_EMAIL);
    await login(INC_JURY);
    expect(await alertsTo("invite_accepted", VC_ADMIN_EMAIL)).toBe(before);
  });

  it("monthly_usage_summary — the daily cron, once per month per recipient", async () => {
    await setDefault("incubator", "monthly_usage_summary", "email", true);
    const before = await alertsTo("monthly_usage_summary", INC_ADMIN_EMAIL);
    const now = new Date("2026-10-03T08:00:00.000Z");

    const first = await runMonthlyUsageSummary(E(), now);
    expect(first.map((s) => s.month)).toEqual(["2026-09", "2026-09"]);
    expect(await alertsTo("monthly_usage_summary", INC_ADMIN_EMAIL)).toBe(before + 1);

    // The other thirty runs of the month are no-ops.
    await runMonthlyUsageSummary(E(), new Date("2026-10-04T08:00:00.000Z"));
    expect(await alertsTo("monthly_usage_summary", INC_ADMIN_EMAIL)).toBe(before + 1);

    // Next month is a new report.
    await runMonthlyUsageSummary(E(), new Date("2026-11-01T08:00:00.000Z"));
    expect(await alertsTo("monthly_usage_summary", INC_ADMIN_EMAIL)).toBe(before + 2);
  });

  it("previousMonth rolls the year over", () => {
    expect(previousMonth(new Date("2026-01-09T00:00:00Z"))).toBe("2025-12");
    expect(previousMonth(new Date("2026-03-31T23:59:00Z"))).toBe("2026-02");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The routes: authZ, and the per-edition round trip.
// ─────────────────────────────────────────────────────────────────────────────

interface GridPayload {
  scope: string;
  events: Array<{ event: string; label: string; sub: string | null }>;
  preferences: NotificationPreferenceView[];
  delivery: { configured: boolean };
  canEditWorkspace: boolean;
}

const grid = async (cookie: string, scope = "") =>
  (await (await get(`/api/notifications${scope}`, cookie)).json()) as GridPayload;

describe("GET /api/notifications", () => {
  it("returns the ten events × two channels with the prototype's copy", async () => {
    const payload = await grid(await login(INC_ADMIN_EMAIL));
    expect(payload.events).toHaveLength(10);
    expect(payload.preferences).toHaveLength(20);
    expect(payload.events[0].label).toBe("New pitchdeck submitted");
    expect(payload.events[1].sub).toBe("Deck has been parsed and pre-scored by the AI engine");
    // F0181 — the one edition-conditional label.
    expect(payload.events[2].label).toBe("Jury member submitted scores");
    // §8 Q11 — the prototype's "mentor review" step does not exist (§1.2).
    expect(payload.events[3].label).not.toContain("mentor");
  });

  it("names the VC evaluator in the VC edition, and nothing else changes", async () => {
    const inc = await grid(await login(INC_ADMIN_EMAIL));
    const vc = await grid(await login(VC_ADMIN_EMAIL));
    expect(vc.events[2].label).toBe("IC member submitted scores");
    const differing = vc.events.filter((e, i) => e.label !== inc.events[i].label);
    expect(differing).toHaveLength(1);
  });

  it("is open to a non-admin for their own scope", async () => {
    const jury = await login(INC_JURY);
    const res = await get("/api/notifications", jury);
    expect(res.status).toBe(200);
    expect(((await res.json()) as GridPayload).canEditWorkspace).toBe(false);
  });

  it("refuses a mentor outright", async () => {
    const mentor = await login(INC_MENTOR);
    expect((await get("/api/notifications", mentor)).status).toBe(403);
    expect((await get("/api/notifications/bell", mentor)).status).toBe(403);
  });
});

describe("authZ", () => {
  it("a non-admin cannot read or write the workspace defaults, or the delivery log", async () => {
    const jury = await login(INC_JURY);
    expect((await get("/api/notifications?scope=workspace", jury)).status).toBe(403);
    expect(
      (
        await put("/api/notifications/preferences?scope=workspace", jury, {
          preferences: [{ event: "deck_submitted", channel: "email", enabled: false }],
        })
      ).status,
    ).toBe(403);
    expect((await get("/api/notifications/outbox", jury)).status).toBe(403);
  });

  it("an unauthenticated caller gets 401 everywhere", async () => {
    expect((await SELF.fetch(`${BASE}/api/notifications`)).status).toBe(401);
    expect((await SELF.fetch(`${BASE}/api/notifications/bell`)).status).toBe(401);
    expect(
      (await SELF.fetch(`${BASE}/api/notifications/preferences`, { method: "PUT" })).status,
    ).toBe(401);
  });

  it("closes with the adminconsole permission, like every other console surface", async () => {
    const admin = await login(INC_ADMIN_EMAIL);
    expect((await get("/api/notifications/outbox", admin)).status).toBe(200);

    // `role_permissions` is keyed (edition, role, task_id) — no surrogate id.
    await env.DB.prepare(
      "INSERT INTO role_permissions (edition, role, task_id, granted) VALUES ('incubator', 'admin', 'adminconsole', 0) " +
        "ON CONFLICT (edition, role, task_id) DO UPDATE SET granted = 0",
    ).run();
    // The grid is read per REQUEST, not baked into the session, so the existing
    // cookie already sees the revocation — no re-login.
    expect((await get("/api/notifications/outbox", admin)).status).toBe(403);
    expect((await get("/api/notifications?scope=workspace", admin)).status).toBe(403);
    // The person's OWN preferences are not an admin surface and stay reachable.
    expect((await get("/api/notifications", admin)).status).toBe(200);

    await env.DB.prepare(
      "UPDATE role_permissions SET granted = 1 WHERE edition = 'incubator' AND role = 'admin' AND task_id = 'adminconsole'",
    ).run();
    expect((await get("/api/notifications/outbox", admin)).status).toBe(200);
  });
});

describe("PUT /api/notifications/preferences", () => {
  const cell = (p: GridPayload, event: string, channel: string) =>
    p.preferences.find((x) => x.event === event && x.channel === channel)!;

  it("writes the caller's own override and reports it as theirs", async () => {
    const admin = await login(INC_ADMIN_EMAIL);
    const before = await grid(admin);
    expect(cell(before, "intro_call_scheduled", "in_app").source).toBe("default");

    const res = await put("/api/notifications/preferences", admin, {
      preferences: [{ event: "intro_call_scheduled", channel: "in_app", enabled: false }],
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as GridPayload;
    expect(cell(after, "intro_call_scheduled", "in_app")).toMatchObject({
      enabled: false,
      source: "user",
    });
    // A WRITE answers with the same whole payload a READ does. The client
    // replaces its state from whichever call it last made, so a partial write
    // response leaves `delivery` / `events` undefined and crashes the next
    // render — which is exactly what the e2e walk caught before this assertion
    // existed.
    expect(after.events).toHaveLength(10);
    expect(after.delivery).toHaveProperty("configured");
    expect(after).toHaveProperty("canEditWorkspace");
    // And it survives a fresh read.
    expect(cell(await grid(admin), "intro_call_scheduled", "in_app").enabled).toBe(false);
  });

  it("DELETE drops the caller's overrides and falls back to the policy", async () => {
    const admin = await login(INC_ADMIN_EMAIL);
    await put("/api/notifications/preferences", admin, {
      preferences: [{ event: "crm_sync_failed", channel: "email", enabled: false }],
    });
    const reset = (await (await del("/api/notifications/preferences", admin)).json()) as GridPayload;
    expect(reset.preferences.every((p) => p.source === "default")).toBe(true);
    expect(reset.events).toHaveLength(10);
    expect(reset.delivery).toHaveProperty("configured");
  });

  it("round-trips the workspace default per edition, without bleeding across", async () => {
    const incAdmin = await login(INC_ADMIN_EMAIL);
    const vcAdmin = await login(VC_ADMIN_EMAIL);

    await put("/api/notifications/preferences?scope=workspace", incAdmin, {
      preferences: [{ event: "monthly_usage_summary", channel: "email", enabled: false }],
    });

    const inc = await grid(incAdmin, "?scope=workspace");
    const vc = await grid(vcAdmin, "?scope=workspace");
    expect(cell(inc, "monthly_usage_summary", "email").enabled).toBe(false);
    expect(cell(vc, "monthly_usage_summary", "email").enabled).toBe(true);

    // Restore, so the producer tests above are not order-dependent on this one.
    await put("/api/notifications/preferences?scope=workspace", incAdmin, {
      preferences: [{ event: "monthly_usage_summary", channel: "email", enabled: true }],
    });
  });

  it("refuses an unknown event, an unknown channel and an empty body", async () => {
    const admin = await login(INC_ADMIN_EMAIL);
    expect(
      (
        await put("/api/notifications/preferences", admin, {
          preferences: [{ event: "not_an_event", channel: "email", enabled: true }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await put("/api/notifications/preferences", admin, {
          preferences: [{ event: "deck_submitted", channel: "sms", enabled: true }],
        })
      ).status,
    ).toBe(400);
    expect((await put("/api/notifications/preferences", admin, { preferences: [] })).status).toBe(
      400,
    );
  });
});

describe("the bell", () => {
  it("lists the caller's own alerts with an unread count, and marks them read", async () => {
    await setDefault("incubator", "deck_submitted", "in_app", true);
    await emitNotification(E(), {
      event: "deck_submitted",
      edition: "incubator",
      title: "Bell fixture",
      link: "/app/decks/bell_fixture",
      dedupeKey: "t_bell_fixture",
    });

    const admin = await login(INC_ADMIN_EMAIL);
    const first = (await (await get("/api/notifications/bell", admin)).json()) as {
      notifications: Array<{ id: string; title: string; link: string | null; readAt: string | null }>;
      unread: number;
    };
    expect(first.unread).toBeGreaterThan(0);
    const fixture = first.notifications.find((n) => n.title === "Bell fixture")!;
    expect(fixture.link).toBe("/app/decks/bell_fixture");

    expect((await post("/api/notifications/read", admin, { id: fixture.id })).status).toBe(200);
    const second = (await (await get("/api/notifications/bell", admin)).json()) as {
      notifications: Array<{ id: string; readAt: string | null }>;
      unread: number;
    };
    expect(second.notifications.find((n) => n.id === fixture.id)!.readAt).toBeTruthy();
    expect(second.unread).toBe(first.unread - 1);

    // Mark-all clears the rest.
    await post("/api/notifications/read", admin, {});
    const third = (await (await get("/api/notifications/bell", admin)).json()) as { unread: number };
    expect(third.unread).toBe(0);
  });

  it("never returns another user's notifications, and marking by a foreign id is a no-op", async () => {
    await env.DB.prepare(
      "INSERT INTO notifications (id, edition, user_id, event_key, title, created_at) " +
        "VALUES ('ntf_foreign', 'incubator', 'inc_pm', 'deck_submitted', 'Not yours', '2026-09-01T00:00:00.000Z')",
    ).run();

    const admin = await login(INC_ADMIN_EMAIL);
    const payload = (await (await get("/api/notifications/bell", admin)).json()) as {
      notifications: Array<{ id: string }>;
    };
    expect(payload.notifications.some((n) => n.id === "ntf_foreign")).toBe(false);

    expect((await post("/api/notifications/read", admin, { id: "ntf_foreign" })).status).toBe(200);
    const still = await env.DB.prepare(
      "SELECT read_at FROM notifications WHERE id = 'ntf_foreign'",
    ).first<{ read_at: string | null }>();
    expect(still?.read_at).toBeNull();
  });
});

describe("GET /api/notifications/outbox (F0144)", () => {
  it("shows what was produced, to whom, and what happened to it", async () => {
    const admin = await login(INC_ADMIN_EMAIL);
    const payload = (await (await get("/api/notifications/outbox", admin)).json()) as {
      entries: Array<{ kind: string; toEmail: string; subject: string; status: string }>;
      delivery: { configured: boolean };
    };
    expect(payload.entries.length).toBeGreaterThan(0);
    expect(payload.entries[0]).toHaveProperty("subject");
    // No verified sending domain in the test Env — and the screen must say so
    // rather than presenting toggles over a transport that is not delivering.
    expect(payload.delivery.configured).toBe(false);
    expect(payload.entries.every((e) => e.status !== "sent")).toBe(true);
  });
});
