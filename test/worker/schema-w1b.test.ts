/**
 * W1-B — the parity programme's schema block (migrations 0025 – 0037).
 *
 * One describe per table, each asserting the three things the session owes:
 *   1. the table exists with the shape later waves will query,
 *   2. its constraints actually reject a bad row (a CHECK nobody tests is a
 *      comment), and
 *   3. its seed matches the prototype / spec default it was transcribed from.
 *
 * There are no routes or UI in this session, so this file is the whole
 * behavioural surface: `env.DB` is the isolated, freshly-migrated D1 that
 * `test/worker/apply-migrations.ts` sets up per test file.
 */
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  DEFAULT_ROLE_PERMISSIONS,
  NOTIFICATION_EVENTS,
  PERMISSION_ROLES,
  RUBRIC_BANDS,
  permissionTasksFor,
} from "../../src/shared/types";
import type { Edition } from "../../src/shared/roles";

const EDITIONS: Edition[] = ["incubator", "vc"];

/** Runs a statement expected to violate a constraint. */
async function rejects(sql: string, ...binds: unknown[]) {
  await expect(env.DB.prepare(sql).bind(...binds).run()).rejects.toThrow();
}

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return row!.n;
}

// ── 0025 · parameters: the spec §6.2 canonical names ────────────────────────

describe("parameters — spec §6.2 role parameters", () => {
  it("carries the canonical nine names per edition, in owner order", async () => {
    const expected: Record<Edition, string[]> = {
      // Program Associate, Program Manager, Jury Member — sort_order 101-109.
      incubator: [
        "Program fit", "Investment stage", "Ask",
        "TRL stage", "Product-Market Fit", "Traction",
        "Barriers of entry", "Scalability", "Industry growth",
      ],
      // Investment Associate, Partner, IC Member.
      vc: [
        "Thesis fit", "Investment stage", "Ask / Ticket size fit",
        "TRL stage", "Product-Market Fit", "Traction",
        "Barriers of entry", "Scalability", "Exit attractiveness",
      ],
    };
    for (const edition of EDITIONS) {
      const { results } = await env.DB.prepare(
        "SELECT name FROM parameters WHERE edition = ? AND informational = 1 AND active = 1 ORDER BY sort_order",
      ).bind(edition).all<{ name: string }>();
      expect(results.map((r) => r.name)).toEqual(expected[edition]);
    }
  });

  it("gives every role parameter a scorer-facing description and an AI prompt", async () => {
    const n = await count(
      "SELECT COUNT(*) n FROM parameters WHERE informational = 1 AND active = 1 " +
        "AND (description IS NULL OR prompt IS NULL)",
    );
    expect(n).toBe(0);
  });

  it("permits configuration of the first parameter of each owning role only", async () => {
    const { results } = await env.DB.prepare(
      "SELECT role_scope, COUNT(*) n FROM parameters " +
        "WHERE informational = 1 AND active = 1 AND config_permitted = 1 GROUP BY role_scope",
    ).all<{ role_scope: string; n: number }>();
    // Six owning roles across the two editions, one permitted parameter each.
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.n === 1)).toBe(true);
  });

  it("leaves the id of every renamed parameter untouched, so seeded scores still join", async () => {
    const orphans = await count(
      "SELECT COUNT(*) n FROM scores s LEFT JOIN parameters p ON p.id = s.parameter_id WHERE p.id IS NULL",
    );
    expect(orphans).toBe(0);
  });
});

// ── 0026 · org_scoring_settings ─────────────────────────────────────────────

describe("org_scoring_settings", () => {
  it("holds one row per edition seeded to the prototype's s-fw defaults", async () => {
    for (const edition of EDITIONS) {
      const row = await env.DB.prepare("SELECT * FROM org_scoring_settings WHERE edition = ?")
        .bind(edition).first<Record<string, unknown>>();
      expect(row).toBeTruthy();
      expect(row).toMatchObject({
        ai_pre_scoring_enabled: 1,
        auto_clarification: 1,
        show_ai_score_to_jury: 1,
        require_override_rationale: 1,
        override_rationale_delta: 2,
        // The one toggle the prototype ships OFF.
        jury_sees_peer_scores: 0,
        score_scale: "0-10",
        composite_formula: "weighted_average",
        ai_weight_pct: 40,
        shortlist_threshold: 7,
        show_three_score_view: 1,
        show_score_drift: 1,
        include_ai_evidence: 1,
        intro_call_ai_prompts: 1,
      });
    }
  });

  it("has no column for the mentor composite override (plan §1.2)", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(org_scoring_settings)")
      .all<{ name: string }>();
    expect(results.map((r) => r.name).filter((n) => n.includes("mentor"))).toEqual([]);
  });

  it("rejects an unknown composite formula and an out-of-range AI weight", async () => {
    await rejects("UPDATE org_scoring_settings SET composite_formula = 'geometric' WHERE edition = 'vc'");
    await rejects("UPDATE org_scoring_settings SET ai_weight_pct = 140 WHERE edition = 'vc'");
    await rejects("UPDATE org_scoring_settings SET score_scale = '0-7' WHERE edition = 'vc'");
  });
});

// ── 0027 · parameter_rubric_bands ───────────────────────────────────────────

describe("parameter_rubric_bands", () => {
  it("scaffolds the spec's five bands for every active parameter in both editions", async () => {
    const params = await count("SELECT COUNT(*) n FROM parameters WHERE active = 1");
    const bands = await count("SELECT COUNT(*) n FROM parameter_rubric_bands");
    expect(bands).toBe(params * RUBRIC_BANDS.length);
  });

  it("seeds 65 anchor strings per edition — the 13 core areas × 5 bands", async () => {
    for (const edition of EDITIONS) {
      const n = await count(
        "SELECT COUNT(*) n FROM parameter_rubric_bands b JOIN parameters p ON p.id = b.parameter_id " +
          "WHERE p.edition = ? AND b.description IS NOT NULL",
        edition,
      );
      expect(n).toBe(65);
    }
  });

  it("uses the spec §7 band mapping, highest band first", async () => {
    const { results } = await env.DB.prepare(
      "SELECT DISTINCT band_index, band_label, band_name, min_score, max_score " +
        "FROM parameter_rubric_bands ORDER BY band_index",
    ).all<{ band_index: number; band_label: string; band_name: string; min_score: number; max_score: number }>();
    expect(results).toEqual(
      RUBRIC_BANDS.map((b) => ({
        band_index: b.index, band_label: b.label, band_name: b.name, min_score: b.min, max_score: b.max,
      })),
    );
  });

  it("carries the prototype's own anchor text for a spot-checked area", async () => {
    const row = await env.DB.prepare(
      "SELECT description FROM parameter_rubric_bands WHERE parameter_id = 'inc_climate_impact' AND band_index = 0",
    ).first<{ description: string }>();
    expect(row!.description).toContain("Transformational impact");
  });

  it("fills the per-area AI guidance prompt the rubric screen edits", async () => {
    const missing = await count(
      "SELECT COUNT(*) n FROM parameters WHERE informational = 0 AND active = 1 AND prompt IS NULL",
    );
    expect(missing).toBe(0);
  });

  it("rejects a sixth band, a bad range and a duplicate band on one parameter", async () => {
    await rejects(
      "INSERT INTO parameter_rubric_bands (id, parameter_id, band_index, band_label, band_name, min_score, max_score) " +
        "VALUES ('bad1', 'inc_climate_impact', 5, '11-12', 'Impossible', 11, 12)",
    );
    await rejects(
      "INSERT INTO parameter_rubric_bands (id, parameter_id, band_index, band_label, band_name, min_score, max_score) " +
        "VALUES ('bad2', 'inc_storytelling', 0, '9–10', 'Exceptional', 9, 10)", // duplicate (parameter, band)
    );
    await rejects(
      "INSERT INTO parameter_rubric_bands (id, parameter_id, band_index, band_label, band_name, min_score, max_score) " +
        "VALUES ('bad3', 'inc_storytelling', 2, '8–4', 'Inverted', 8, 4)", // max < min
    );
  });
});

// ── 0028 · question_bank ────────────────────────────────────────────────────

describe("question_bank", () => {
  it("seeds 68 questions per edition — five per area, eight for Climate Impact", async () => {
    for (const edition of EDITIONS) {
      const total = await count(
        "SELECT COUNT(*) n FROM question_bank q JOIN parameters p ON p.id = q.parameter_id WHERE p.edition = ?",
        edition,
      );
      expect(total).toBe(68);

      const { results } = await env.DB.prepare(
        "SELECT p.key, COUNT(*) n FROM question_bank q JOIN parameters p ON p.id = q.parameter_id " +
          "WHERE p.edition = ? GROUP BY p.key",
      ).bind(edition).all<{ key: string; n: number }>();
      expect(results).toHaveLength(13);
      const climate = results.find((r) => r.key === "climate_impact");
      expect(climate!.n).toBe(8);
      expect(results.filter((r) => r.key !== "climate_impact").every((r) => r.n === 5)).toBe(true);
    }
  });

  it("carries the prototype's own question text", async () => {
    const row = await env.DB.prepare(
      "SELECT text FROM question_bank WHERE parameter_id = 'inc_problem_market_clarity' AND seq = 1",
    ).first<{ text: string }>();
    expect(row!.text).toBe("Who is the primary customer facing this problem?");
  });

  it("rejects a question with no parameter and cascades when one is removed", async () => {
    await rejects(
      "INSERT INTO question_bank (id, parameter_id, seq, text) VALUES ('qbad', 'nope', 1, 'x')",
    );
    await env.DB.prepare("INSERT INTO parameters (id, edition, key, name) VALUES ('tmp_p', 'vc', 'tmp', 'Temp')").run();
    await env.DB.prepare("INSERT INTO question_bank (id, parameter_id, seq, text) VALUES ('qtmp', 'tmp_p', 1, 'x')").run();
    await env.DB.prepare("DELETE FROM parameters WHERE id = 'tmp_p'").run();
    expect(await count("SELECT COUNT(*) n FROM question_bank WHERE id = 'qtmp'")).toBe(0);
  });
});

// ── 0029 · role_permissions ─────────────────────────────────────────────────

describe("role_permissions", () => {
  it("is the full 21 × 5 incubator and 24 × 6 VC matrix — 249 rows", async () => {
    expect(await count("SELECT COUNT(*) n FROM role_permissions")).toBe(249);
    expect(await count("SELECT COUNT(*) n FROM role_permissions WHERE edition = 'incubator'")).toBe(21 * 5);
    expect(await count("SELECT COUNT(*) n FROM role_permissions WHERE edition = 'vc'")).toBe(24 * 6);
  });

  it("matches DEFAULT_ROLE_PERMISSIONS cell for cell", async () => {
    const { results } = await env.DB.prepare(
      "SELECT edition, role, task_id, granted FROM role_permissions",
    ).all<{ edition: Edition; role: string; task_id: string; granted: number }>();
    const seeded = new Map(results.map((r) => [`${r.edition}/${r.role}/${r.task_id}`, r.granted]));

    let cells = 0;
    for (const edition of EDITIONS) {
      for (const task of permissionTasksFor(edition)) {
        const granted = DEFAULT_ROLE_PERMISSIONS[edition][task.id] as readonly string[];
        for (const role of PERMISSION_ROLES[edition]) {
          const key = `${edition}/${role}/${task.id}`;
          expect(seeded.get(key), key).toBe(granted.includes(role) ? 1 : 0);
          cells++;
        }
      }
    }
    expect(cells).toBe(249);
  });

  it("grants the superuser every task in its edition", async () => {
    const denied = await count(
      "SELECT COUNT(*) n FROM role_permissions WHERE role = 'superuser' AND granted = 0",
    );
    expect(denied).toBe(0);
  });

  it("holds no row for founder or mentor — isolation is not a toggle", async () => {
    expect(await count("SELECT COUNT(*) n FROM role_permissions WHERE role IN ('founder', 'mentor')")).toBe(0);
  });

  it("rejects a non-boolean grant, an unknown edition and a duplicate cell", async () => {
    await rejects("INSERT INTO role_permissions (edition, role, task_id, granted) VALUES ('incubator', 'jury', 'x', 2)");
    await rejects("INSERT INTO role_permissions (edition, role, task_id, granted) VALUES ('agency', 'jury', 'x', 1)");
    await rejects("INSERT INTO role_permissions (edition, role, task_id, granted) VALUES ('incubator', 'jury', 'evaluate', 1)");
  });
});

// ── 0030 · audit_log ────────────────────────────────────────────────────────

describe("audit_log", () => {
  it("stores a config event with NO deck — the reason this table exists", async () => {
    await env.DB.prepare(
      "INSERT INTO audit_log (id, edition, category, action, summary) VALUES ('t1', 'vc', 'config', 'threshold_changed', 'x')",
    ).run();
    const row = await env.DB.prepare("SELECT deck_id, category FROM audit_log WHERE id = 't1'")
      .first<{ deck_id: string | null; category: string }>();
    expect(row!.deck_id).toBeNull();
    expect(row!.category).toBe("config");
  });

  it("seeds the prototype's ten-row trail across four categories", async () => {
    expect(await count("SELECT COUNT(*) n FROM audit_log WHERE id LIKE 'aud_%'")).toBe(10);
    const { results } = await env.DB.prepare(
      "SELECT category, COUNT(*) n FROM audit_log WHERE id LIKE 'aud_%' GROUP BY category ORDER BY category",
    ).all<{ category: string; n: number }>();
    expect(results).toEqual([
      { category: "billing", n: 1 },
      { category: "config", n: 6 },
      { category: "score", n: 2 },
      { category: "team", n: 1 },
    ]);
    // Eight of the ten are not about a deck at all — config, team and billing.
    expect(await count("SELECT COUNT(*) n FROM audit_log WHERE id LIKE 'aud_%' AND deck_id IS NULL")).toBe(8);
  });

  it("rejects an unknown category", async () => {
    await rejects(
      "INSERT INTO audit_log (id, edition, category, action, summary) VALUES ('t2', 'vc', 'gossip', 'x', 'y')",
    );
  });

  it("keeps the row when the actor is deleted", async () => {
    await env.DB.prepare(
      "INSERT INTO users (id, name, email, role, edition, initials) VALUES ('tmp_u', 'T', 't@x.dev', 'jury', 'incubator', 'T')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO audit_log (id, edition, category, actor_id, actor_label, action, summary) " +
        "VALUES ('t3', 'incubator', 'team', 'tmp_u', 'T.', 'x', 'y')",
    ).run();
    await env.DB.prepare("DELETE FROM users WHERE id = 'tmp_u'").run();
    const row = await env.DB.prepare("SELECT actor_id, actor_label FROM audit_log WHERE id = 't3'")
      .first<{ actor_id: string | null; actor_label: string }>();
    expect(row!.actor_id).toBeNull();
    expect(row!.actor_label).toBe("T.");
  });
});

// ── 0031 · notification_preferences ─────────────────────────────────────────

describe("notification_preferences", () => {
  it("seeds a workspace default per event × channel × edition", async () => {
    const expected = NOTIFICATION_EVENTS.length * 2 * EDITIONS.length;
    expect(await count("SELECT COUNT(*) n FROM notification_preferences WHERE user_id IS NULL")).toBe(expected);
  });

  it("matches the prototype's ON/OFF state — eight on, two off", async () => {
    for (const event of NOTIFICATION_EVENTS) {
      const { results } = await env.DB.prepare(
        "SELECT enabled FROM notification_preferences WHERE user_id IS NULL AND event_key = ?",
      ).bind(event.key).all<{ enabled: number }>();
      expect(results).toHaveLength(4); // 2 editions × 2 channels
      expect(results.every((r) => r.enabled === (event.defaultOn ? 1 : 0)), event.key).toBe(true);
    }
    expect(NOTIFICATION_EVENTS.filter((e) => !e.defaultOn).map((e) => e.key))
      .toEqual(["founder_responded", "invite_accepted"]);
  });

  it("lets a user override the workspace default without colliding with it", async () => {
    await env.DB.prepare(
      "INSERT INTO notification_preferences (id, edition, user_id, event_key, channel, enabled) " +
        "VALUES ('np_u1', 'incubator', 'inc_jury', 'deck_submitted', 'email', 0)",
    ).run();
    expect(
      await count("SELECT COUNT(*) n FROM notification_preferences WHERE event_key = 'deck_submitted' AND channel = 'email'"),
    ).toBe(3);
  });

  it("rejects a second workspace default and an unknown channel", async () => {
    await rejects(
      "INSERT INTO notification_preferences (id, edition, user_id, event_key, channel, enabled) " +
        "VALUES ('np_dup', 'incubator', NULL, 'deck_submitted', 'email', 1)",
    );
    await rejects(
      "INSERT INTO notification_preferences (id, edition, user_id, event_key, channel, enabled) " +
        "VALUES ('np_bad', 'incubator', NULL, 'deck_submitted', 'sms', 1)",
    );
  });
});

// ── 0032 · credit_ledger ────────────────────────────────────────────────────

describe("credit_ledger", () => {
  it("nets to the balance org_settings already carries, in both editions", async () => {
    for (const edition of EDITIONS) {
      const ledger = await count("SELECT COALESCE(SUM(delta), 0) n FROM credit_ledger WHERE edition = ?", edition);
      const balance = await count("SELECT credits_balance n FROM org_settings WHERE edition = ?", edition);
      expect(ledger, edition).toBe(balance);
    }
  });

  // W4-C — RESTATED, not weakened (§4), and flagged in the handoff. This asserted
  // that every `deck_evaluated` row carries ₹999, the per-deck rate `s-bl.html`
  // renders. **§8 Q1 was ruled by the user on 2026-09-11: there is no per-deck
  // pricing**, and a client ruling outranks the prototype it was written from
  // (§1.1), so `0046` cleared the figure from the data rather than leaving a rate
  // in a column no screen may render. The property is now the inverse — and it is
  // the stronger one, because it holds for every future row as well as the seeded
  // ones. Metering is untouched: the row itself, and its delta of exactly −1, are
  // still asserted here and in `test/worker/billing.test.ts`.
  it("records an evaluation as one credit and no money (§8 Q1: no per-deck rate)", async () => {
    const { results } = await env.DB.prepare(
      "SELECT delta, amount_minor, currency FROM credit_ledger WHERE reason = 'deck_evaluated'",
    ).all<{ delta: number; amount_minor: number | null; currency: string | null }>();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.delta === -1)).toBe(true);
    expect(results.every((r) => r.amount_minor === null && r.currency === null)).toBe(true);
  });

  it("keeps the money on a purchase, which really did cost money", async () => {
    const { results } = await env.DB.prepare(
      "SELECT amount_minor, currency FROM credit_ledger WHERE reason = 'purchase'",
    ).all<{ amount_minor: number; currency: string }>();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.amount_minor === 2000000 && r.currency === "INR")).toBe(true);
  });

  it("rejects a zero movement, an unknown reason and a half-specified amount", async () => {
    await rejects("INSERT INTO credit_ledger (id, edition, delta, reason) VALUES ('x1', 'vc', 0, 'purchase')");
    await rejects("INSERT INTO credit_ledger (id, edition, delta, reason) VALUES ('x2', 'vc', 1, 'gift')");
    await rejects(
      "INSERT INTO credit_ledger (id, edition, delta, reason, amount_minor) VALUES ('x3', 'vc', 1, 'purchase', 100)",
    );
  });

  it("keeps the ledger row when its deck is deleted", async () => {
    await env.DB.prepare(
      "INSERT INTO credit_ledger (id, edition, delta, reason, deck_id) VALUES ('x4', 'vc', -1, 'deck_evaluated', 'vc_deck_wealthos')",
    ).run();
    await env.DB.prepare("DELETE FROM decks WHERE id = 'vc_deck_wealthos'").run();
    const row = await env.DB.prepare("SELECT deck_id FROM credit_ledger WHERE id = 'x4'")
      .first<{ deck_id: string | null }>();
    expect(row!.deck_id).toBeNull();
  });
});

// ── 0033 · price configuration ──────────────────────────────────────────────

describe("price configuration", () => {
  it("activates the seven currencies the page lists, INR first", async () => {
    const { results } = await env.DB.prepare("SELECT code FROM currencies ORDER BY sort_order")
      .all<{ code: string }>();
    expect(results.map((r) => r.code)).toEqual(["INR", "USD", "GBP", "EUR", "AED", "SGD", "AUD"]);
  });

  it("carries the page's live FX rates against the INR base", async () => {
    const usd = await env.DB.prepare("SELECT rate, source FROM fx_rates WHERE currency = 'USD'")
      .first<{ rate: number; source: string }>();
    expect(usd).toEqual({ rate: 0.01199, source: "live" });
    const base = await env.DB.prepare("SELECT rate FROM fx_rates WHERE currency = 'INR'").first<{ rate: number }>();
    expect(base!.rate).toBe(1);
  });

  it("seeds the four catalogues with the page's own prices", async () => {
    const { results } = await env.DB.prepare(
      "SELECT plan_group, COUNT(*) n FROM price_plans GROUP BY plan_group ORDER BY plan_group",
    ).all<{ plan_group: string; n: number }>();
    expect(results).toEqual([
      { plan_group: "credit_pack", n: 4 },
      { plan_group: "enterprise", n: 5 },
      { plan_group: "free_trial", n: 1 },
      { plan_group: "subscription", n: 2 },
    ]);
    const pro = await env.DB.prepare(
      "SELECT amount_minor FROM price_amounts WHERE plan_id = 'pp_pro' AND currency = 'INR'",
    ).first<{ amount_minor: number }>();
    expect(pro!.amount_minor).toBe(199900); // ₹1,999 / mo
    const pack50 = await env.DB.prepare(
      "SELECT amount_minor, per_unit_label FROM price_amounts WHERE plan_id = 'pp_pack_50' AND currency = 'INR'",
    ).first<{ amount_minor: number; per_unit_label: string }>();
    expect(pack50).toEqual({ amount_minor: 2000000, per_unit_label: "₹400/deck" });
  });

  it("holds the singleton tax and free-trial configuration", async () => {
    const row = await env.DB.prepare("SELECT * FROM pricing_settings").first<Record<string, unknown>>();
    expect(row).toMatchObject({
      id: 1, gst_rate_pct: 18, gst_registration: "29ABCDE1234F1Z5",
      prices_include_gst: 0, show_international_tax_notice: 1,
      free_trial_decks: 3, free_trial_expiry_days: 0, show_free_trial: 1,
    });
  });

  it("stores no card, CVV or payment-instrument column anywhere (plan §1.2)", async () => {
    // Read the DDL rather than PRAGMA: it covers every user table in one query
    // and needs no privilege the Worker runtime withholds.
    const { results } = await env.DB.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf%' ESCAPE '\\'",
    ).all<{ name: string; sql: string | null }>();
    expect(results.length).toBeGreaterThan(30);
    const banned = /\b(card_number|cardnumber|card_no|cvv|cvc|card_expiry|pan_number)\b/i;
    for (const { name, sql } of results) {
      expect(banned.test(sql ?? ""), `${name} declares a card/CVV column`).toBe(false);
    }
  });

  it("rejects a second settings row, a negative price and a duplicate plan currency", async () => {
    await rejects("INSERT INTO pricing_settings (id) VALUES (2)");
    await rejects(
      "INSERT INTO price_amounts (id, plan_id, currency, amount_minor) VALUES ('pa_bad', 'pp_pro', 'AED', -1)",
    );
    await rejects(
      "INSERT INTO price_amounts (id, plan_id, currency, amount_minor) VALUES ('pa_dup', 'pp_pro', 'INR', 1)",
    );
  });
});

// ── 0034 · signups / required_documents / signup_documents ──────────────────

describe("sign-up workspace", () => {
  it("seeds the edition default checklists from s-sudocs", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name, mandatory FROM required_documents WHERE edition = 'incubator' AND program_id IS NULL ORDER BY sort_order",
    ).all<{ name: string; mandatory: number }>();
    expect(results).toEqual([
      { name: "Certificate of incorporation", mandatory: 1 },
      { name: "Founder ID proof", mandatory: 1 },
      { name: "Cap table", mandatory: 1 },
      { name: "Bank account details", mandatory: 0 },
      { name: "GST / tax registration", mandatory: 0 },
    ]);
    // The VC edition adds Audited financials.
    expect(
      await count("SELECT COUNT(*) n FROM required_documents WHERE edition = 'vc' AND name = 'Audited financials'"),
    ).toBe(1);
  });

  it("opens a sign-up for every deck already in the sign-up funnel, with its checklist", async () => {
    const decks = await count("SELECT COUNT(*) n FROM decks WHERE status IN ('signup', 'onboard_ready')");
    expect(decks).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*) n FROM signups")).toBe(decks);
    const orphan = await count(
      "SELECT COUNT(*) n FROM signups s WHERE NOT EXISTS (SELECT 1 FROM signup_documents d WHERE d.signup_id = s.id)",
    );
    expect(orphan).toBe(0);
  });

  it("walks a document through the spec §8.3 lifecycle and rejects an unknown state", async () => {
    const id = (await env.DB.prepare("SELECT id FROM signup_documents LIMIT 1").first<{ id: string }>())!.id;
    for (const status of ["awaiting", "submitted"]) {
      await env.DB.prepare("UPDATE signup_documents SET status = ? WHERE id = ?").bind(status, id).run();
    }
    await env.DB.prepare(
      "UPDATE signup_documents SET status = 'verified', verified_by = 'inc_admin', verified_at = datetime('now') WHERE id = ?",
    ).bind(id).run();
    await rejects("UPDATE signup_documents SET status = 'approved' WHERE id = ?", id);
    // Verified without a timestamp is not a state this table will hold.
    await rejects("UPDATE signup_documents SET verified_at = NULL WHERE id = ?", id);
  });

  it("requires a reason to waive a document", async () => {
    const id = (await env.DB.prepare("SELECT id FROM signup_documents LIMIT 1").first<{ id: string }>())!.id;
    await rejects("UPDATE signup_documents SET waived = 1 WHERE id = ?", id);
  });

  it("rejects an unknown signing provider, a second sign-up per deck, and a seated seatless row", async () => {
    const deck = (await env.DB.prepare("SELECT deck_id FROM signups LIMIT 1").first<{ deck_id: string }>())!.deck_id;
    await rejects("UPDATE signups SET signing_provider = 'FaxIt' WHERE deck_id = ?", deck);
    await rejects("INSERT INTO signups (id, deck_id) VALUES ('su_dup', ?)", deck);
    await rejects(
      "UPDATE signups SET seatless = 1, seat_allocated_at = datetime('now') WHERE deck_id = ?", deck,
    );
  });
});

// ── 0035 · agreements & signatures ──────────────────────────────────────────

describe("agreements & signatures", () => {
  it("seeds the four templates per edition with their status and stage", async () => {
    const { results } = await env.DB.prepare(
      "SELECT code, version, status, stage FROM agreement_templates WHERE edition = 'incubator' ORDER BY id",
    ).all<{ code: string; version: string; status: string; stage: string }>();
    expect(results).toEqual([
      { code: "incubation_agreement", version: "v3", status: "active", stage: "on_signup" },
      { code: "mentorship_mou", version: "v1", status: "draft", stage: "on_signup" },
      { code: "mutual_nda", version: "v1", status: "retired", stage: "pre_signup" },
      { code: "safe_note", version: "v2", status: "active", stage: "on_signup" },
    ]);
    expect(await count("SELECT COUNT(*) n FROM agreement_templates WHERE edition = 'vc'")).toBe(4);
  });

  it("gives every template a three-step signing workflow ending in a countersign", async () => {
    const { results } = await env.DB.prepare(
      "SELECT template_id, COUNT(*) n FROM agreement_flow_steps GROUP BY template_id",
    ).all<{ template_id: string; n: number }>();
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.n === 3)).toBe(true);
    expect(await count("SELECT COUNT(*) n FROM agreement_flow_steps WHERE step_index = 3 AND action = 'countersign'")).toBe(8);
  });

  it("marks the merge fields the prototype's editor shows", async () => {
    const { results } = await env.DB.prepare(
      "SELECT key, label FROM agreement_template_fields WHERE template_id = 'at_inc_incub' ORDER BY sort_order",
    ).all<{ key: string; label: string }>();
    expect(results.map((r) => r.key)).toEqual(["startup", "founder", "date", "term", "equity"]);
    expect(results[4].label).toBe("Equity consideration");
  });

  it("authorises signatories by role and by named individual, per s-susign", async () => {
    const roleOn = await env.DB.prepare(
      "SELECT role FROM authorised_signatories WHERE edition = 'incubator' AND role IS NOT NULL AND enabled = 1 ORDER BY role",
    ).all<{ role: string }>();
    expect(roleOn.results.map((r) => r.role)).toEqual(["program_manager", "superuser"]);
    const userOn = await env.DB.prepare(
      "SELECT user_id FROM authorised_signatories WHERE edition = 'vc' AND user_id IS NOT NULL AND enabled = 1 ORDER BY user_id",
    ).all<{ user_id: string }>();
    expect(userOn.results.map((r) => r.user_id)).toEqual(["vc_partner", "vc_superuser"]);
  });

  it("rejects a signatory that is both a role and a person, or neither", async () => {
    await rejects(
      "INSERT INTO authorised_signatories (id, edition, role, user_id, enabled) VALUES ('as_bad1', 'vc', 'partner', 'vc_partner', 1)",
    );
    await rejects(
      "INSERT INTO authorised_signatories (id, edition, role, user_id, enabled) VALUES ('as_bad2', 'vc', NULL, NULL, 1)",
    );
  });

  it("records a stubbed signature and refuses one with no signer at all", async () => {
    const signup = (await env.DB.prepare("SELECT id FROM signups LIMIT 1").first<{ id: string }>())!.id;
    await env.DB.prepare(
      "INSERT INTO agreements (id, signup_id, template_id, kind) VALUES ('ag1', ?, 'at_inc_incub', 'incubation_agreement')",
    ).bind(signup).run();
    await env.DB.prepare(
      "INSERT INTO signatures (id, agreement_id, signer_email, signer_name, method_provider, sig_type, provider_reference, signed_at) " +
        "VALUES ('sig1', 'ag1', 'founder@example.dev', 'A Founder', 'DocuSign', 'standard', 'stub:recorded:1', datetime('now'))",
    ).run();
    const sig = await env.DB.prepare("SELECT provider_reference FROM signatures WHERE id = 'sig1'")
      .first<{ provider_reference: string }>();
    expect(sig!.provider_reference).toBe("stub:recorded:1");

    await rejects("INSERT INTO signatures (id, agreement_id) VALUES ('sig_bad', 'ag1')");
    await rejects(
      "INSERT INTO signatures (id, agreement_id, signer_email, method_provider) VALUES ('sig_bad2', 'ag1', 'x@y.dev', 'Notary')",
    );
  });

  it("refuses a countersign recorded with no timestamp", async () => {
    const signup = (await env.DB.prepare("SELECT id FROM signups LIMIT 1").first<{ id: string }>())!.id;
    await env.DB.prepare("INSERT INTO agreements (id, signup_id, kind) VALUES ('ag2', ?, 'mentorship_mou')").bind(signup).run();
    await rejects("UPDATE agreements SET countersigned_by = 'inc_superuser' WHERE id = 'ag2'");
  });
});

// ── 0036 · seat capacity ────────────────────────────────────────────────────

describe("seat capacity", () => {
  it("gives every cohort one of the prototype's three demo capacities", async () => {
    expect(await count("SELECT COUNT(*) n FROM cohorts WHERE seat_capacity IS NULL OR seats_filled IS NULL")).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM cohorts WHERE seat_capacity = 0")).toBe(0);
    const { results } = await env.DB.prepare("SELECT seat_capacity, seats_filled FROM cohorts")
      .all<{ seat_capacity: number; seats_filled: number }>();
    const prototypeRows = ["20/18", "15/9", "12/12"];
    for (const r of results) {
      expect(prototypeRows).toContain(`${r.seat_capacity}/${r.seats_filled}`);
    }
  });

  it("leaves at least one cohort exactly at capacity, so the seatless path is reachable", async () => {
    expect(await count("SELECT COUNT(*) n FROM cohorts WHERE seats_filled >= seat_capacity")).toBeGreaterThan(0);
  });

  it("leaves the VC Fund Deployment figures on programs, where 0011 put them", async () => {
    const fund = await env.DB.prepare(
      "SELECT fund_size, fund_allocated, capital_deployed FROM programs WHERE edition = 'vc' AND name = 'Fund II'",
    ).first<{ fund_size: number; fund_allocated: number; capital_deployed: number }>();
    expect(fund).toEqual({ fund_size: 300, fund_allocated: 210, capital_deployed: 92 });
  });
});

// ── 0037 · crm_connections ──────────────────────────────────────────────────

describe("crm_connections", () => {
  it("lists all four providers per edition with Salesforce live", async () => {
    for (const edition of EDITIONS) {
      const { results } = await env.DB.prepare(
        "SELECT provider, status FROM crm_connections WHERE edition = ? ORDER BY provider",
      ).bind(edition).all<{ provider: string; status: string }>();
      expect(results).toEqual([
        { provider: "custom", status: "inactive" },
        { provider: "hubspot", status: "inactive" },
        { provider: "pipedrive", status: "inactive" },
        { provider: "salesforce", status: "live" },
      ]);
    }
  });

  it("carries the prototype's Salesforce filter rules", async () => {
    const row = await env.DB.prepare("SELECT * FROM crm_connections WHERE id = 'crm_inc_salesforce'")
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      trigger_field: "Stage",
      trigger_value: "Submitted for evaluation",
      monthly_deck_cap: 50,
      score_writeback_field: "AI_Score__c",
      auto_approve_within_cap: 1,
      write_back_scores: 1,
      last_sync_count: 3,
    });
  });

  it("holds no credential column (plan §1.3 — settings here, secrets in the Worker)", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(crm_connections)").all<{ name: string }>();
    const secretish = results.map((r) => r.name).filter((n) => /token|secret|api_key|password|client_id/i.test(n));
    expect(secretish).toEqual([]);
  });

  it("rejects an unknown provider and a duplicate connection", async () => {
    await rejects("INSERT INTO crm_connections (id, edition, provider) VALUES ('crm_bad', 'vc', 'zoho_crm')");
    await rejects("INSERT INTO crm_connections (id, edition, provider) VALUES ('crm_dup', 'vc', 'salesforce')");
  });
});
