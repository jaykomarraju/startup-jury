import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import {
  TENANT_KEYED_TABLES,
  TENANT_OWNER,
  PLATFORM_GLOBAL_TABLES,
  scoped,
  type TenantScope,
} from "../../src/shared/tenant";

/**
 * TENANT ISOLATION — THE GENERIC INVARIANT
 * ========================================
 *
 * **T0-SCHEMA ships this file. The seven T1 sessions EXTEND it. None of them
 * writes its own isolation test.**
 *
 * The measurement this whole wave exists for: a second accelerator added to a
 * local copy — brand-new account, zero decks — signed in and saw all 15 decks
 * with founder names, emails and phones, plus 8 staff rows and 12 audit rows
 * belonging to the first. The only scope on the deck listing is `d.edition = ?`
 * (`routes/decks.ts:480`) and `edition` has two values, so every accelerator
 * shares a bucket.
 *
 * ── THE SHAPE, AND WHY IT IS A RATCHET AND NOT A WISHLIST ───────────────────
 *
 * T0 creates the tenant key. T1 applies it to 211 predicates across 51 files. So
 * on the day this file is written, almost every route still leaks — and a test
 * that simply asserted "no route leaks" would ship red, which is the one thing a
 * foundation session cannot do: seven T1 branches are cut from T0's commit, and a
 * red `main` is seven red branches.
 *
 * So every case carries a STATUS, and **both directions fail**:
 *
 *   · `enforced` — isolation is asserted. A leak fails the test.
 *   · `pending`  — the leak is asserted AS A FACT, with the session that owns the
 *                  fix. When the fix lands the leak stops and the case fails with
 *                  "this no longer leaks — promote it to enforced". A `pending`
 *                  row cannot rot into a lie, and it cannot be quietly left behind:
 *                  integration asserts that none remain.
 *   · `unprobed` — the route answers 200 and shows no marker, and the stated reason
 *                  says why the marker cannot reach it: tenant B has no row in the
 *                  table this route reads, or the route returns ids rather than
 *                  text, or it is scoped per USER so a tenant-A principal would not
 *                  see tenant B's row even unscoped. **This is not evidence of
 *                  isolation and the test says so.** A leak appearing here still
 *                  fails, and the session that scopes the route adds the fixture
 *                  that makes it probeable before promoting it.
 *   · `blocked`  — isolation cannot even be tested yet, because the schema does not
 *                  currently permit a second tenant's row in that table. Five
 *                  tables are in this position and the reason is named below. A
 *                  `blocked` case that becomes testable also fails.
 *
 * The three statuses are the difference between a test that documents progress and
 * a test that goes vacuously green. §11's instruction is that T1 sessions "extend
 * its table list; they do not each invent an isolation test", and the only way that
 * works is if adding a row here is cheaper than writing a file.
 *
 * ── HOW TO EXTEND IT (read this before adding a case) ───────────────────────
 *
 * 1. Find your route in `ROUTE_PROBES`. Change `status` from `pending` to
 *    `enforced` and delete the `owner` field. That is the whole edit.
 * 1b. If it is `unprobed`, the edit is bigger and that is the point: give tenant B
 *    a row the route can actually return (a `TENANT_B_FIXTURES` entry, or a
 *    `queries` / `calls` / `signups` row hanging off `zz_deck`), watch the case flip
 *    to a real leak, THEN scope the route and promote it to `enforced`. Promoting
 *    an `unprobed` case straight to `enforced` asserts nothing.
 * 2. A route not listed: add one entry — `{ id, path, as, status, owner }`. `as` is
 *    the tenant-A principal whose session should not see tenant B's rows.
 * 3. A table not listed in `TENANT_B_FIXTURES`: add the minimal INSERT that gives
 *    tenant B one row carrying `MARKER`. Everything else is automatic — the
 *    column census, the helper-level isolation check and the marker sweep all
 *    iterate the fixtures.
 *
 * ── THE THREE LAYERS, AND WHY THE SECOND ONE IS THE REAL TEST ──────────────
 *
 * **Layer 1 — the key and the helper.** Every table in `TENANT_KEYED_TABLES` has
 * the column; every predicate `src/shared/tenant.ts` builds excludes tenant B;
 * every proxy path in `TENANT_OWNER` reaches an owner. This passes today and it is
 * what T1 builds on. It cannot catch a route that forgets to call the helper.
 *
 * **Layer 2 — the routes.** Log in as tenant A and sweep every response body for
 * tenant B's marker. This is the layer that catches a missing predicate, and it is
 * the layer that is mostly `pending` today.
 *
 * **Layer 3 — the writes.** A missing read predicate returns the wrong rows and
 * this file sees it. A missing `tenant_id` on an INSERT puts a row in the wrong
 * customer's workspace and **nothing looks wrong** — the response is a 201 and the
 * row is there. All 30 `tenant_id` columns carry `DEFAULT 't_default'` (SQLite
 * offers no other way to backfill a NOT NULL column, and `0087`'s header records
 * why the eleven rebuilt tables took the default too), so a forgotten bind lands
 * silently in the first customer. Layer 3 is the only thing that can see that.
 *
 * ── AGGREGATES GET THEIR OWN LAYER, BECAUSE A MARKER SWEEP CANNOT SEE THEM ──
 *
 * §11's second standing instruction: "Aggregates are the dangerous shape, not the
 * lists. A list that leaks shows another customer's startup names and somebody
 * notices. A `COUNT(*)` or an `AVG(score)` that leaks returns a perfectly
 * ordinary-looking number." There is no marker in a mean. `AGGREGATE_PROBES`
 * therefore asserts by VALUE: tenant B's fixture rows are given extreme values, so
 * a leaking aggregate moves and an isolated one does not.
 */

const BASE = "https://example.com";

/** The string that must never cross. Chosen to be impossible in the seed. */
const MARKER = "ZZTENANTB";

/** The second customer. Created by this file, never by a migration. */
const TENANT_B = "t_zz_isolation";
const TENANT_B_SLUG = "zz-isolation";

/** Tenant A is the backfilled organisation every seeded row belongs to. */
const TENANT_A = "t_default";

const A_SCOPE: TenantScope = { tenantId: TENANT_A, edition: "incubator" };
const B_SCOPE: TenantScope = { tenantId: TENANT_B, edition: "incubator" };

/** Seeded tenant-A principals, by the role whose screens each probe exercises. */
const ADMIN = "nisha.kapoor@demo.startupjury.ai";
const PM = "raj.kumar@demo.startupjury.ai";

type Status = "enforced" | "pending" | "unprobed" | "blocked";

/** How each status reads in the test name, so a run is a progress report. */
const LABEL: Record<Status, string> = {
  enforced: "isolates",
  pending: "still leaks (pending)",
  unprobed: "cannot be probed yet (unprobed)",
  blocked: "blocked",
};

/**
 * **THE FIVE TABLES THAT CANNOT HOLD A SECOND TENANT'S ROW YET.**
 *
 * `0091`–`0095` widened these tables' primary keys to include `tenant_id` and
 * then left the OLD key standing as an ordinary unique index, because nine
 * `ON CONFLICT (<old key>)` upserts in six files owned by four different T1
 * sessions resolve against it and would otherwise fail outright. Those
 * transitional indexes are what let T0 merge green; they are dropped at T1
 * integration from the declared headroom once the nine upserts name the widened
 * key. See `0091_role_permissions_tenant_rebuild.sql`'s header.
 *
 * While they stand, a second customer's configuration row collides. That is a
 * LOUD failure — a UNIQUE violation naming the index — and it is the correct error
 * for "T1 has not finished yet". It is recorded here rather than worked around,
 * because the alternative is a test that silently covers 25 tables while claiming
 * 30.
 */
const BLOCKED_BY_TRANSITIONAL_KEY = new Set([
  "role_permissions",
  "score_visibility",
  "seat_capabilities",
  "account_profiles",
  "billing_subscriptions",
]);

interface Fixture {
  /** The SQL that gives tenant B one row. `MARKER` must appear in a text column. */
  readonly sql: string;
  readonly binds?: readonly unknown[];
  /** Why this table has no fixture, when it has none. */
  readonly blocked?: string;
}

/**
 * ONE ROW OF TENANT B's DATA PER TENANT-KEYED TABLE.
 *
 * Every `MARKER` is a string a tenant-A principal must never see. The ids are
 * `zz_`-prefixed so a set assertion taken over that prefix does not depend on what
 * else is in the database — worker D1 state persists across tests in this pool.
 */
const TENANT_B_FIXTURES: Readonly<Record<string, Fixture>> = {
  users: {
    sql:
      "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
      // The same password hash as the seeded demo accounts, so tenant B's admin
      // can actually sign in — which is what Layer 3 needs.
      "SELECT 'zz_admin', ?, ? , 'zz.admin@" + MARKER.toLowerCase() + ".test', 'admin', 'incubator', 'ZZ', password_hash " +
      "FROM users WHERE email = '" + ADMIN + "'",
    binds: [TENANT_B, `${MARKER} Admin`],
  },
  decks: {
    // `ai_score` is LOAD-BEARING, added by T1-REPORTS: `GET /api/analytics/drift`
    // selects `WHERE ai_score IS NOT NULL`, so with it null the drift probe
    // answered 200 with tenant B absent and read as isolated when the route was
    // not scoped at all. Measured: the probe passed against an unscoped
    // `analytics.ts`. 1.1 is deliberately below every seeded score, so it also
    // moves any mean that leaks. Do not set it back to null without re-marking
    // that probe `unprobed`.
    sql:
      "INSERT INTO decks (id, tenant_id, edition, name, status, founder_email, founder_phone, ai_score) " +
      "VALUES ('zz_deck', ?, 'incubator', ?, 'new', ?, '+91 00000 00000', 1.1)",
    binds: [TENANT_B, `${MARKER} Startup`, `founder@${MARKER.toLowerCase()}.test`],
  },
  audit_log: {
    sql:
      "INSERT INTO audit_log (id, tenant_id, edition, category, action, summary) " +
      "VALUES ('zz_audit', ?, 'incubator', 'security', 'ownership_transferred', ?)",
    binds: [TENANT_B, `${MARKER} transferred ownership`],
  },
  tickets: {
    sql: "INSERT INTO tickets (id, tenant_id, edition, subject) VALUES ('zz_ticket', ?, 'incubator', ?)",
    binds: [TENANT_B, `${MARKER} cannot log in`],
  },
  messages: {
    sql:
      "INSERT INTO messages (id, tenant_id, edition, to_scope, body) " +
      "VALUES ('zz_msg', ?, 'incubator', 'admin', ?)",
    binds: [TENANT_B, `${MARKER} private message`],
  },
  notifications: {
    sql:
      "INSERT INTO notifications (id, tenant_id, edition, user_id, event_key, title) " +
      "VALUES ('zz_notif', ?, 'incubator', 'zz_admin', 'deck_uploaded', ?)",
    binds: [TENANT_B, `${MARKER} Startup uploaded a deck`],
  },
  notification_preferences: {
    sql:
      "INSERT INTO notification_preferences (id, tenant_id, edition, event_key, channel, enabled) " +
      "VALUES ('zz_np', ?, 'incubator', ?, 'email', 1)",
    binds: [TENANT_B, `${MARKER}_event`],
  },
  programs: {
    sql: "INSERT INTO programs (id, tenant_id, edition, name) VALUES ('zz_prog', ?, 'incubator', ?)",
    binds: [TENANT_B, `${MARKER} Accelerator`],
  },
  sectors: {
    sql: "INSERT INTO sectors (id, tenant_id, edition, name) VALUES ('zz_sector', ?, 'incubator', ?)",
    binds: [TENANT_B, `${MARKER} Sector`],
  },
  parameters: {
    sql:
      "INSERT INTO parameters (id, tenant_id, edition, key, name, weight) " +
      "VALUES ('zz_param', ?, 'incubator', ?, ?, 10)",
    binds: [TENANT_B, `${MARKER}_key`, `${MARKER} Parameter`],
  },
  required_documents: {
    sql:
      "INSERT INTO required_documents (id, tenant_id, edition, name) VALUES ('zz_rd', ?, 'incubator', ?)",
    binds: [TENANT_B, `${MARKER} Document`],
  },
  credit_ledger: {
    sql:
      "INSERT INTO credit_ledger (id, tenant_id, edition, delta, reason, note) " +
      "VALUES ('zz_cl', ?, 'incubator', 999, 'purchase', ?)",
    binds: [TENANT_B, `${MARKER} credit purchase`],
  },
  account_orders: {
    // `account_orders` carries no free-text column of its own, and `intent_id` is
    // both its primary key and a foreign key to `billing_payment_intents` — so the
    // order IS its intent, and the MARKER rides on `billing_payment_intents.plan_name`
    // one hop away. Tenant A must not see either.
    sql:
      "INSERT INTO account_orders (intent_id, tenant_id, edition, account_type, plan_group, payment_method, taxed) " +
      "VALUES ('zz_intent', ?, 'incubator', 'organization', 'enterprise', 'upi', 1)",
    binds: [TENANT_B],
  },
  billing_invoices: {
    sql:
      "INSERT INTO billing_invoices (id, tenant_id, edition, number, description, currency, " +
      "subtotal_minor, tax_minor, total_minor, gst_rate_pct) " +
      "VALUES ('zz_inv', ?, 'incubator', 'ZZ-0001', ?, 'INR', 100, 18, 118, 18)",
    binds: [TENANT_B, `${MARKER} invoice`],
  },
  billing_payment_intents: {
    sql:
      "INSERT INTO billing_payment_intents (id, tenant_id, edition, purpose, plan_name, currency, " +
      "subtotal_minor, tax_minor, total_minor, gst_rate_pct) " +
      "VALUES ('zz_intent', ?, 'incubator', 'credit_pack', ?, 'INR', 100, 18, 118, 18)",
    binds: [TENANT_B, `${MARKER} intent`],
  },
  seat_grants: {
    sql:
      "INSERT INTO seat_grants (id, tenant_id, edition, tier, quantity, reason, note) " +
      "VALUES ('zz_seat', ?, 'incubator', 'pro', 5, 'purchase', ?)",
    binds: [TENANT_B, `${MARKER} seat grant`],
  },
  agreement_templates: {
    sql:
      "INSERT INTO agreement_templates (id, tenant_id, edition, code, name) " +
      "VALUES ('zz_tmpl', ?, 'incubator', ?, ?)",
    binds: [TENANT_B, `${MARKER}_nda`, `${MARKER} NDA`],
  },
  authorised_signatories: {
    sql:
      "INSERT INTO authorised_signatories (id, tenant_id, edition, user_id, enabled) " +
      "VALUES ('zz_sig', ?, 'incubator', 'zz_admin', 1)",
    binds: [TENANT_B],
  },
  crm_connections: {
    sql:
      "INSERT INTO crm_connections (id, tenant_id, edition, provider, base_url, credential_hint) " +
      "VALUES ('zz_crm', ?, 'incubator', 'hubspot', ?, ?)",
    binds: [TENANT_B, `https://${MARKER.toLowerCase()}.example.com`, `${MARKER}_key_hint`],
  },
  crm_sync_log: {
    sql:
      "INSERT INTO crm_sync_log (id, tenant_id, connection_id, edition, provider, direction, operation, status, error) " +
      "VALUES ('zz_csl', ?, 'zz_crm', 'incubator', 'hubspot', 'pull', 'deal_import', 'ok', ?)",
    binds: [TENANT_B, `${MARKER} synced`],
  },
  resubmit_tokens: {
    sql:
      "INSERT INTO resubmit_tokens (id, tenant_id, deck_id, edition, token_hash, expires_at) " +
      "VALUES ('zz_tok', ?, 'zz_deck', 'incubator', ?, datetime('now', '+7 days'))",
    binds: [TENANT_B, `${MARKER}_hash`],
  },
  email_outbox: {
    sql:
      "INSERT INTO email_outbox (id, tenant_id, kind, to_email, subject, body) " +
      "VALUES ('zz_eo', ?, 'founder_query', ?, ?, ?)",
    binds: [
      TENANT_B,
      `founder@${MARKER.toLowerCase()}.test`,
      `${MARKER} Startup — a question`,
      `${MARKER} body`,
    ],
  },
  esign_outbox: {
    sql:
      "INSERT INTO esign_outbox (id, tenant_id, kind, provider, sig_type, status, document_name) " +
      "VALUES ('zz_xo', ?, 'envelope_create', 'SignDesk', 'standard', 'recorded', ?)",
    binds: [TENANT_B, `${MARKER}.pdf`],
  },
  org_settings: {
    sql:
      "INSERT INTO org_settings (tenant_id, edition, ai_system_prompt) VALUES (?, 'incubator', ?)",
    binds: [TENANT_B, `${MARKER} system prompt`],
  },
  org_scoring_settings: {
    sql: "INSERT INTO org_scoring_settings (tenant_id, edition, ai_weight_pct) VALUES (?, 'incubator', 11)",
    binds: [TENANT_B],
  },

  // ── blocked: see BLOCKED_BY_TRANSITIONAL_KEY ───────────────────────────────
  role_permissions: { sql: "", blocked: "0091's transitional UNIQUE (edition, role, task_id)" },
  score_visibility: { sql: "", blocked: "0092's transitional UNIQUE (edition, viewer_role, target_role)" },
  seat_capabilities: { sql: "", blocked: "0093's transitional UNIQUE (edition, param_set, tier)" },
  account_profiles: { sql: "", blocked: "0094's transitional UNIQUE (edition)" },
  billing_subscriptions: { sql: "", blocked: "0095's transitional UNIQUE (edition)" },
};

/**
 * **THE PROXY FIXTURES — the second extension point, added by T1-REPORTS.**
 *
 * `TENANT_B_FIXTURES` above is one row per TENANT-KEYED table and the registry
 * test asserts its keys are exactly `TENANT_KEYED_TABLES`, so a row in a
 * scoped-by-proxy table has nowhere to go there. That is what left ten cases
 * `unprobed`: the note in "HOW TO EXTEND IT" §1b asks for "a `queries` / `calls`
 * / `signups` row hanging off `zz_deck`" and there was no place to put one.
 *
 * This is the place. Each entry gives tenant B one row in a table that has no
 * tenant key of its own, hanging off a fixture above, so that a route reading
 * that table has something to leak. They are seeded after the keyed fixtures and
 * before any probe runs.
 *
 * **A fixture here can turn another session's `unprobed` case into a REAL leak,
 * and that is the point of adding one.** When it does, move that case to
 * `pending` with its owner rather than deleting it or working around it — the
 * owner then has a negative control instead of a case that could never have
 * failed. T1-REPORTS added `zz_jury` and `zz_eval` for its own two reports and
 * that flipped `B7 evaluators` (T1-DECKS) from `unprobed` to `pending`, which is
 * one more measured leak than the file carried before.
 */
const TENANT_B_PROXY_FIXTURES: readonly {
  /** What it exists for, named so a later session can tell whether it may change it. */
  readonly id: string;
  readonly sql: string;
  readonly binds?: readonly unknown[];
}[] = [
  {
    // A second tenant-B principal, with an EVALUATOR role. `zz_admin` is an
    // admin, so every route that filters `users` to the evaluator roles found
    // nothing to leak and read as isolated when it was not.
    id: "zz_jury — an evaluator-role principal for tenant B",
    sql:
      "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
      "SELECT 'zz_jury', ?, ?, 'zz.jury@" + MARKER.toLowerCase() + ".test', 'jury', 'incubator', 'ZJ', password_hash " +
      "FROM users WHERE email = '" + ADMIN + "'",
    binds: [TENANT_B, `${MARKER} Juror`],
  },
  {
    // `evaluations` is scoped only through `decks` (`TENANT_OWNER`), and it is
    // what `humanEvalsByDeck` reads for three incubator reports. The total is
    // deliberately 9.9 — far above any seeded score — so a leaking MEAN moves
    // visibly rather than by a rounding step.
    id: "zz_eval — a tenant-B evaluation, for the reports that take a mean",
    sql:
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at) " +
      "VALUES ('zz_eval', 'zz_deck', 'zz_jury', 9.9, 'advance', ?, datetime('now'))",
    binds: [`${MARKER} remarks`],
  },
  {
    // `pipeline_events` likewise. This is what `GET /api/activity` reads, and
    // without it that probe could not have failed: the route returns the DECK
    // NAME from the joined `decks` row, so one event on `zz_deck` is enough to
    // put `ZZTENANTB Startup` in the response of a route that is not scoped.
    id: "zz_pe — a tenant-B stage transition, for GET /api/activity",
    sql:
      "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note) " +
      "VALUES ('zz_pe', 'zz_deck', 'zz_admin', 'new', 'shortlisted', 'stage_changed', ?)",
    binds: [`${MARKER} moved to shortlisted`],
  },
];

interface RouteProbe {
  readonly id: string;
  readonly path: string;
  readonly as: string;
  readonly status: Status;
  /** The T1 session that owns the fix. Required while `pending` or `unprobed`. */
  readonly owner?: string;
  /** Why the marker cannot reach this response. Required while `unprobed`. */
  readonly reason?: string;
}

/**
 * LAYER 2's WORKLIST. One line per route family in §2's leak table.
 *
 * Flip `status` to `enforced` and drop `owner` when your session scopes the
 * route. Integration asserts that nothing is left `pending`.
 */
const ROUTE_PROBES: readonly RouteProbe[] = [
  // ── measured to leak today. These are the real negative controls. ───────────
  { id: "B1 decks", path: "/api/decks", as: PM, status: "pending", owner: "T1-DECKS" },
  // T1-REPORTS. `/api/audit` returns the trail AND the actor list, so this one
  // probe covers both of `audit/log.ts`'s union branches and `listAuditActors`'s
  // two. Measured before the fix: the response carried `ZZTENANTB transferred
  // ownership` — an `ownership_transferred` row, §2's own example.
  { id: "B5 audit", path: "/api/audit", as: ADMIN, status: "enforced" },
  { id: "B6 users", path: "/api/users", as: ADMIN, status: "pending", owner: "T1-PEOPLE" },
  { id: "B9 config parameters", path: "/api/config/parameters", as: ADMIN, status: "pending", owner: "T1-CONFIG" },
  { id: "B9 config summary", path: "/api/config/summary", as: ADMIN, status: "pending", owner: "T1-CONFIG" },
  { id: "B15 esign templates", path: "/api/esign/templates", as: ADMIN, status: "pending", owner: "T1-ESIGN" },
  { id: "B15 esign signatories", path: "/api/esign/signatories", as: ADMIN, status: "pending", owner: "T1-ESIGN" },
  { id: "B16 billing", path: "/api/billing", as: ADMIN, status: "pending", owner: "T1-COMMERCE" },
  { id: "B17 seats", path: "/api/seats", as: ADMIN, status: "pending", owner: "T1-PEOPLE" },
  { id: "B18 account", path: "/api/account", as: ADMIN, status: "pending", owner: "T1-COMMERCE" },
  { id: "B20 tickets", path: "/api/tickets", as: ADMIN, status: "pending", owner: "T1-COMMERCE" },
  { id: "B20 messages", path: "/api/messages", as: ADMIN, status: "pending", owner: "T1-COMMERCE" },
  { id: "B24 programs", path: "/api/programs", as: ADMIN, status: "pending", owner: "T1-FLOW" },
  // Both of these read as unprobeable at the path the leak table names and leak at
  // the path the console actually calls. Measured, not assumed: `/api/config/sectors`
  // does not exist (the sectors list is served inside `GET /api/config`) and
  // signup-config's documents live at `/documents`, not at the router root. A probe
  // pointed at a 404 proves nothing, which is why the `status !== 200` guard above
  // fails loudly instead of passing quietly.
  { id: "B9 config sectors", path: "/api/config", as: ADMIN, status: "pending", owner: "T1-CONFIG" },
  { id: "B13 signup-config documents", path: "/api/signup-config/documents", as: ADMIN, status: "pending", owner: "T1-FLOW" },

  // ── measured NOT to leak, and in every case because the marker cannot reach
  //    the response — never because the route is scoped. Each needs the named
  //    fixture before it can test anything. ──────────────────────────────────
  {
    id: "B3 queries",
    path: "/api/queries",
    as: PM,
    status: "unprobed",
    owner: "T1-DECKS",
    reason: "tenant B has no `queries` row — needs one hanging off `zz_deck`",
  },
  // T1-REPORTS. Was `unprobed` for exactly the reason recorded — tenant B had no
  // `pipeline_events` row — so `TENANT_B_PROXY_FIXTURES` supplies `zz_pe` FIRST,
  // the case was watched failing as a real leak, and only then was the route
  // scoped. Promoting it straight to `enforced` would have asserted nothing.
  { id: "B4 activity", path: "/api/activity", as: ADMIN, status: "enforced" },
  // T1-REPORTS supplied the missing fixture its `reason` named — `zz_jury`, in
  // `TENANT_B_PROXY_FIXTURES` — and the case promptly leaked. It is `pending`
  // rather than `unprobed` now: T1-DECKS has a real negative control on
  // `pipeline.ts:1186`'s evaluator roster instead of a case that could not fail.
  { id: "B7 evaluators", path: "/api/evaluators", as: PM, status: "pending", owner: "T1-DECKS" },
  {
    id: "B8 analytics funnel",
    path: "/api/analytics/funnel",
    as: ADMIN,
    status: "unprobed",
    // T1-REPORTS, and this one STAYS unprobed after the fix, which is the honest
    // answer rather than a missing one. `buildFunnel` returns stage labels from a
    // constant and counts from the rows; no text from any deck reaches the
    // response, so no fixture can put a marker in it. A marker sweep cannot test
    // this route — so `layer 2c` tests it by VALUE instead, against the live
    // route, and that is where the funnel's isolation is actually asserted.
    reason:
      "returns counts, not names — the marker sweep is structurally blind here, which is §11's " +
      "whole point about aggregates. No fixture can change that; see `layer 2c`, which asserts " +
      "this route's NUMBER against tenant B gaining rows.",
  },
  // T1-REPORTS — three reports this session owns that the file carried no probe
  // for at all. Each returns free text drawn from the rows it aggregates, so
  // unlike the funnel they ARE marker-probeable, and each one was measured
  // leaking before the fix: `/analytics/evaluators` named `ZZTENANTB Juror` with
  // their average, `/analytics/cohort` listed `ZZTENANTB Startup`, and
  // `/analytics/decisions` carried `zz_pe`'s transition against it.
  { id: "B8 analytics evaluators", path: "/api/analytics/evaluators", as: ADMIN, status: "enforced" },
  { id: "B8 analytics cohort", path: "/api/analytics/cohort", as: ADMIN, status: "enforced" },
  { id: "B8 analytics drift", path: "/api/analytics/drift", as: ADMIN, status: "enforced" },
  {
    id: "B10 permissions",
    path: "/api/permissions",
    as: ADMIN,
    status: "unprobed",
    owner: "T1-CONFIG",
    reason:
      "returns task ids and booleans, no free text — and `role_permissions` is one of the five " +
      "tables 0091-0095's transitional keys still block, so tenant B cannot have a row to leak",
  },
  {
    id: "B11 calls",
    path: "/api/calls",
    as: PM,
    status: "unprobed",
    owner: "T1-FLOW",
    reason: "tenant B has no `calls` row — needs one on `zz_deck`",
  },
  {
    id: "B12 signups",
    path: "/api/signups",
    as: ADMIN,
    status: "unprobed",
    owner: "T1-FLOW",
    reason: "tenant B has no `signups` row — needs one on `zz_deck`",
  },
  {
    id: "B19 crm",
    path: "/api/crm",
    as: ADMIN,
    status: "unprobed",
    owner: "T1-ESIGN",
    reason: "returns one connection per provider and shapes the response from the request, not the row set",
  },
  {
    id: "B21 notifications",
    path: "/api/notifications",
    as: ADMIN,
    status: "unprobed",
    owner: "T1-PEOPLE",
    reason:
      "scoped per USER, so tenant A's admin would not see tenant B's notification even with no " +
      "tenant predicate at all. The leak §2 B22 names is OUTBOUND — `email_outbox`'s fan-out — " +
      "and it leaves the Worker rather than appearing in a response.",
  },
];

/**
 * LAYER 2b — the aggregate probes, asserted by VALUE because there is no marker
 * in a mean. Each fixture row above carries a deliberately extreme number
 * (`credit_ledger.delta = 999`, `org_scoring_settings.ai_weight_pct = 11`,
 * `seat_grants.quantity = 5`) so a leaking aggregate moves and an isolated one
 * does not.
 */
const AGGREGATE_PROBES: readonly {
  id: string;
  /** What the product computes today. */
  unscoped: string;
  /** The same number, scoped. `{W}` is replaced by the WHERE clause. */
  scopedSql: string;
  table: string;
  owner: string;
}[] = [
  {
    id: "credit balance must not sum across customers",
    unscoped: "SELECT coalesce(sum(delta), 0) AS v FROM credit_ledger",
    scopedSql: "SELECT coalesce(sum(t.delta), 0) AS v FROM credit_ledger t {W}",
    table: "credit_ledger",
    owner: "T1-COMMERCE",
  },
  {
    id: "deck counts must not sum across customers",
    unscoped: "SELECT count(*) AS v FROM decks",
    scopedSql: "SELECT count(*) AS v FROM decks t {W}",
    table: "decks",
    owner: "T1-REPORTS",
  },
  {
    id: "seat capacity must not sum across customers",
    unscoped: "SELECT coalesce(sum(quantity), 0) AS v FROM seat_grants",
    scopedSql: "SELECT coalesce(sum(t.quantity), 0) AS v FROM seat_grants t {W}",
    table: "seat_grants",
    owner: "T1-PEOPLE",
  },
];

async function login(email: string, password = "demo1234"): Promise<string | null> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) return null;
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function body(path: string, cookie: string): Promise<{ status: number; text: string }> {
  const res = await SELF.fetch(`${BASE}${path}`, { headers: { cookie } });
  return { status: res.status, text: await res.text() };
}

const seeded: string[] = [];
const proxySeeded: string[] = [];
const blocked: string[] = [];

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, status) VALUES (?, ?, ?, 'active') ON CONFLICT (id) DO NOTHING",
  )
    .bind(TENANT_B, `${MARKER} Ventures`, TENANT_B_SLUG)
    .run();

  // Dependency order, declared rather than inferred: several fixtures are foreign
  // keys to one another — `account_orders.intent_id` IS a
  // `billing_payment_intents` row, `billing_invoices` references both that and
  // `credit_ledger`, `crm_sync_log` hangs off `crm_connections`, and seven tables
  // reference `zz_admin`. Object key order would work today and break the first
  // time somebody adds a fixture in the wrong place, with a bare
  // `FOREIGN KEY constraint failed` and no clue which table.
  const FIRST = [
    "users",
    "decks",
    "billing_payment_intents",
    "credit_ledger",
    "crm_connections",
  ];
  const order = [...FIRST, ...Object.keys(TENANT_B_FIXTURES).filter((t) => !FIRST.includes(t))];
  for (const table of order) {
    const fixture = TENANT_B_FIXTURES[table];
    if (fixture.blocked) {
      blocked.push(table);
      continue;
    }
    await env.DB.prepare(fixture.sql)
      .bind(...(fixture.binds ?? []))
      .run();
    seeded.push(table);
  }

  // The proxy rows go last: every one of them references a keyed fixture above.
  for (const fixture of TENANT_B_PROXY_FIXTURES) {
    await env.DB.prepare(fixture.sql)
      .bind(...(fixture.binds ?? []))
      .run();
    proxySeeded.push(fixture.id);
  }
});

describe("tenancy · the registry itself", () => {
  it("covers every tenant-keyed table, with no table left unaccounted for", () => {
    // A table given a `tenant_id` column without a fixture here would otherwise be
    // silently untested — which is how an isolation suite goes vacuously green.
    expect(Object.keys(TENANT_B_FIXTURES).sort()).toEqual([...TENANT_KEYED_TABLES].sort());
  });

  it("agrees with the database about which tables carry the key", async () => {
    for (const table of TENANT_KEYED_TABLES) {
      const row = await env.DB.prepare(
        "SELECT count(*) n FROM pragma_table_info(?) WHERE name = 'tenant_id'",
      )
        .bind(table)
        .first<{ n: number }>();
      expect(row!.n, `${table} has no tenant_id column`).toBe(1);
    }
  });

  it("leaves the eight platform-global tables alone", async () => {
    // §3 measured five independent reasons the price catalogue is one book for the
    // whole product. A sweep that "finishes the job" by scoping these is wrong, and
    // `0100`'s integrity assertion fails the migration chain if it happens.
    for (const table of PLATFORM_GLOBAL_TABLES) {
      const row = await env.DB.prepare(
        "SELECT count(*) n FROM pragma_table_info(?) WHERE name = 'tenant_id'",
      )
        .bind(table)
        .first<{ n: number }>();
      expect(row!.n, `${table} must NOT be tenant-scoped — see plan_multitenancy.md §3`).toBe(0);
    }
  });

  it("records exactly the five tables a transitional key still blocks", () => {
    expect(new Set(blocked)).toEqual(BLOCKED_BY_TRANSITIONAL_KEY);
  });

  it("the blocked tables really are blocked, and fail LOUDLY when they are not", async () => {
    // The point of `blocked` is that it expires. When integration drops a
    // transitional index, the insert below starts succeeding and this fails —
    // which is the signal to move that table into the fixtures above.
    for (const table of BLOCKED_BY_TRANSITIONAL_KEY) {
      const row = await env.DB.prepare(
        "SELECT count(*) n FROM sqlite_master WHERE type = 'index' AND name = ?",
      )
        .bind(`${table}__pre_tenant_key`)
        .first<{ n: number }>();
      const partial = table === "authorised_signatories";
      expect(
        row!.n,
        `${table}'s transitional index is gone — move it out of BLOCKED_BY_TRANSITIONAL_KEY ` +
          `and give it a TENANT_B_FIXTURES row`,
      ).toBe(partial ? 0 : 1);
    }
  });
});

describe("tenancy · layer 1 — the key and the scope helper", () => {
  it("seeded tenant B, so the rest of this file is not vacuous", async () => {
    expect(seeded.length).toBeGreaterThan(20);
    const row = await env.DB.prepare("SELECT count(*) n FROM organizations").first<{ n: number }>();
    expect(row!.n).toBe(2);
  });

  it("every direct-column predicate the helper builds excludes tenant B, table by table", async () => {
    for (const table of seeded) {
      const hasEdition = await env.DB.prepare(
        "SELECT count(*) n FROM pragma_table_info(?) WHERE name = 'edition'",
      )
        .bind(table)
        .first<{ n: number }>();
      // The helper binds BOTH halves of the workspace key, so the expected answer
      // is tenant A's rows IN THIS EDITION — not tenant A's rows altogether. Getting
      // that wrong is how an isolation assertion ends up measuring `edition` and
      // calling it tenancy, which is the bug the whole wave is about.
      const q = hasEdition!.n ? scoped(A_SCOPE).on("t") : scoped(A_SCOPE).onTenantOnly("t");
      const got = (
        await env.DB.prepare(`SELECT count(*) n FROM ${table} t ${q.whereClause()}`)
          .bind(...q.binds)
          .first<{ n: number }>()
      )!.n;
      const expected = (
        await env.DB.prepare(
          hasEdition!.n
            ? `SELECT count(*) n FROM ${table} WHERE tenant_id = ? AND edition = ?`
            : `SELECT count(*) n FROM ${table} WHERE tenant_id = ?`,
        )
          .bind(...(hasEdition!.n ? [TENANT_A, A_SCOPE.edition] : [TENANT_A]))
          .first<{ n: number }>()
      )!.n;
      const theirs = (
        await env.DB.prepare(`SELECT count(*) n FROM ${table} WHERE tenant_id = ?`)
          .bind(TENANT_B)
          .first<{ n: number }>()
      )!.n;
      expect(theirs, `${table}: tenant B has no row, so this table proves nothing`).toBeGreaterThan(0);
      expect(got, `${table}: tenant A's scoped read did not return exactly tenant A's rows`).toBe(
        expected,
      );
    }
  });

  it("seeded tenant B's PROXY rows too, so the ten unprobed cases can be worked off", async () => {
    // Without these, a route that reads only proxy tables answers 200 with an
    // empty list and the marker sweep calls it isolated. Asserted by COUNT so a
    // fixture that silently failed to insert is caught here rather than showing
    // up as a probe that cannot fail.
    expect(proxySeeded).toEqual(TENANT_B_PROXY_FIXTURES.map((f) => f.id));
    for (const [table, id] of [
      ["evaluations", "zz_eval"],
      ["pipeline_events", "zz_pe"],
    ] as const) {
      const row = await env.DB.prepare(`SELECT count(*) n FROM ${table} WHERE id = ?`)
        .bind(id)
        .first<{ n: number }>();
      expect(row!.n, `${table}: ${id} is missing`).toBe(1);
    }
  });

  it("every proxy path reaches an owner, and the join excludes tenant B", async () => {
    // The 31 tables with no tenant column of their own. `signatures` is three hops
    // — `signatures → agreements → signups → decks`, the deepest in the schema.
    for (const table of Object.keys(TENANT_OWNER)) {
      const q = scoped(B_SCOPE);
      const joins = q.viaParent(table, "c");
      const sql = `SELECT count(*) n FROM ${table} c ${joins} ${q.whereClause()}`;
      // It must EXECUTE — a wrong column or a missing table in TENANT_OWNER is a
      // compile-time-looking error that only SQL can find.
      const row = await env.DB.prepare(sql).bind(...q.binds).first<{ n: number }>();
      expect(row, `${table}: the owner path in TENANT_OWNER does not execute`).toBeTruthy();
      // Tenant B owns one deck and, since `TENANT_B_PROXY_FIXTURES` was added, one
      // evaluation and one stage event hanging off it — so a deck-owned proxy
      // table is no longer necessarily empty for tenant B, and this case asserts
      // the partition rather than the emptiness: the two tenants' scoped reads
      // must not overlap or over-count. A path wired to the wrong parent returns
      // tenant A's rows on the tenant-B side and breaks the sum.
      const scopedToB = row!.n;
      const q2 = scoped(A_SCOPE);
      const joins2 = q2.viaParent(table, "c");
      const scopedToA = (
        await env.DB.prepare(`SELECT count(*) n FROM ${table} c ${joins2} ${q2.whereClause()}`)
          .bind(...q2.binds)
          .first<{ n: number }>()
      )!.n;
      const total = (
        await env.DB.prepare(`SELECT count(*) n FROM ${table}`).first<{ n: number }>()
      )!.n;
      expect(
        scopedToA + scopedToB,
        `${table}: the two tenants' scoped reads overlap or over-count (${scopedToA} + ${scopedToB} vs ${total} rows)`,
      ).toBeLessThanOrEqual(total);
    }
  });

  it("refuses a table it has no owner path for, instead of inventing a predicate", () => {
    expect(() => scoped(A_SCOPE).viaParent("sqlite_sequence", "x")).toThrow(/no owner path/);
    // And it says the right thing for a table that does carry the column.
    expect(() => scoped(A_SCOPE).viaParent("decks", "d")).toThrow(/carries tenant_id directly/);
  });

  it("builds the predicate and its binds together, in order", () => {
    const q = scoped(A_SCOPE).on("d").and("d.status = ?", "new").andRaw("d.deleted_at IS NULL");
    expect(q.where).toBe(
      "d.tenant_id = ? AND d.edition = ? AND d.status = ? AND d.deleted_at IS NULL",
    );
    expect(q.binds).toEqual([TENANT_A, "incubator", "new"]);
    // A fresh array each read, so a caller cannot mutate the builder's state.
    expect(q.binds).not.toBe(q.binds);
  });
});

describe("tenancy · layer 2 — the routes", () => {
  it("tenant B's own principal can sign in, so a cross-tenant probe is possible", async () => {
    const cookie = await login(`zz.admin@${MARKER.toLowerCase()}.test`);
    expect(cookie, "tenant B's admin cannot sign in — the rest of layer 2 proves nothing").toBeTruthy();
  });

  it("an address held by two customers no longer collides, and login says which workspace", async () => {
    // §2 A7, the finding that "blocks the model outright": `users.email` was
    // globally UNIQUE, so two customers could not both employ one person. `0087`
    // made it `UNIQUE (tenant_id, email)` and this is the proof.
    const hash = await env.DB.prepare("SELECT password_hash FROM users WHERE email = ?")
      .bind(ADMIN)
      .first<{ password_hash: string }>();
    await env.DB.prepare(
      "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
        "VALUES ('zz_shared', ?, ?, ?, 'admin', 'incubator', 'ZS', ?)",
    )
      .bind(TENANT_B, `${MARKER} Shared Human`, ADMIN, hash!.password_hash)
      .run();

    // Both accounts open with the same password, so login cannot choose for them.
    const res = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ADMIN, password: "demo1234" }),
    });
    expect(res.status).toBe(409);
    const json = await res.json<{ error: string; tenants: { slug: string }[] }>();
    expect(json.error).toBe("tenant_required");
    expect(json.tenants.map((t) => t.slug).sort()).toEqual(["default", TENANT_B_SLUG]);

    // And naming the workspace resolves it — to THAT workspace, not the other one.
    const picked = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ADMIN, password: "demo1234", tenant: TENANT_B_SLUG }),
    });
    expect(picked.status).toBe(200);
    const who = await picked.json<{ user: { tenantId: string; id: string } }>();
    expect(who.user.tenantId).toBe(TENANT_B);
    expect(who.user.id).toBe("zz_shared");

    await env.DB.prepare("DELETE FROM users WHERE id = 'zz_shared'").run();
  });

  it("a suspended organisation cannot sign in, however good the credential", async () => {
    await env.DB.prepare("UPDATE organizations SET status = 'suspended' WHERE id = ?")
      .bind(TENANT_B)
      .run();
    const cookie = await login(`zz.admin@${MARKER.toLowerCase()}.test`);
    expect(cookie).toBeNull();
    await env.DB.prepare("UPDATE organizations SET status = 'active' WHERE id = ?")
      .bind(TENANT_B)
      .run();
  });

  it("an unknown tenant slug fails as an ordinary bad credential, not as a 404", async () => {
    // Otherwise login is an oracle for which customers exist.
    const res = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ADMIN, password: "demo1234", tenant: "no-such-customer" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  // The ratchet. Both directions fail: a `pending` route that stops leaking is as
  // much a failure as an `enforced` route that starts.
  for (const probe of ROUTE_PROBES) {
    it(`${LABEL[probe.status]} — ${probe.id}`, async () => {
      const cookie = await login(probe.as);
      expect(cookie, `could not sign in as ${probe.as}`).toBeTruthy();
      const { status, text } = await body(probe.path, cookie!);
      // A route that 403s or 404s tells us nothing either way.
      if (status !== 200) {
        expect(
          status,
          `${probe.id}: ${probe.path} answered ${status}, so this case proves nothing — ` +
            `fix the probe's principal or path`,
        ).toBe(200);
      }
      const leaks = text.includes(MARKER);
      if (probe.status === "enforced") {
        expect(leaks, `${probe.id} leaked tenant B into ${probe.path}`).toBe(false);
      } else if (probe.status === "pending") {
        expect(
          leaks,
          `${probe.id} NO LONGER LEAKS — ${probe.owner} has scoped ${probe.path}. ` +
            `Change its status to "enforced" and drop the owner field.`,
        ).toBe(true);
      } else {
        // `unprobed`. The absence of the marker here is NOT evidence of isolation —
        // `reason` says why it could never have appeared. What this arm does catch is
        // a leak STARTING, which would be news.
        expect(
          leaks,
          `${probe.id} now leaks where the marker was previously unreachable — ${probe.reason}`,
        ).toBe(false);
      }
    });
  }
});

describe("tenancy · layer 2b — aggregates, which have no marker to sweep", () => {
  for (const probe of AGGREGATE_PROBES) {
    it(`${probe.id} — the two numbers differ, so a leak is detectable (${probe.owner})`, async () => {
      const unscoped = (await env.DB.prepare(probe.unscoped).first<{ v: number }>())!.v;
      const q = scoped(A_SCOPE).on("t");
      const correct = (
        await env.DB.prepare(probe.scopedSql.replace("{W}", q.whereClause()))
          .bind(...q.binds)
          .first<{ v: number }>()
      )!.v;
      // This case asserts the PROBE, not the product: tenant B must contribute
      // enough to the unscoped number that a leaking aggregate is distinguishable
      // from an isolated one. If the two numbers ever coincide, this aggregate has
      // become undetectable and the fixture needs a more distinctive value — which
      // is exactly how an aggregate test goes quietly useless.
      expect(
        unscoped,
        `${probe.id}: tenant B contributes nothing distinguishable to this aggregate, so no ` +
          `test of ${probe.table} can detect a leak — give tenant B a fixture row with a value ` +
          `that moves it`,
      ).not.toBe(correct);
    });
  }
});

/**
 * LAYER 2c — THE AGGREGATE ROUTES, ADDED BY T1-REPORTS.
 *
 * `AGGREGATE_PROBES` above asserts something important but narrow: that tenant B
 * contributes enough to each aggregate for a leak to be DETECTABLE. It compares
 * two SQL statements the test itself writes. It never calls the product.
 *
 * So nothing in this file could see the leak §11 calls the dangerous one. The
 * funnel is the named example — "`routes/analytics.ts` has 77 `edition` mentions
 * and is the largest concentration of this shape" — and its response is counts and
 * constant stage labels, so there is no marker to sweep and `ROUTE_PROBES` is
 * structurally blind to it. A marker-blind route is not a scoped route.
 *
 * This layer asserts the product's own number, by VALUE, with the one control that
 * cannot go vacuous: **give tenant B more rows and require the number not to
 * move**, while proving in the same test that the rows were really added and that
 * an unscoped count DOES move. A route that forgot its predicate fails here even
 * though its response contains nothing recognisable.
 */
describe("tenancy · layer 2c — the aggregate routes, which have no marker at all", () => {
  /** Stage-0 of the incubator funnel counts every deck, so the top row is the total. */
  async function funnelTop(cookie: string): Promise<number> {
    const { status, text } = await body("/api/analytics/funnel", cookie);
    expect(status, `/api/analytics/funnel answered ${status}`).toBe(200);
    const json = JSON.parse(text) as { rows: { label: string; count: number }[] };
    expect(json.rows.length, "the funnel returned no rows, so its top is not a number").toBeGreaterThan(0);
    return json.rows[0].count;
  }

  it("the pipeline funnel's counts do not move when another customer gains decks", async () => {
    const cookie = await login(ADMIN);
    expect(cookie).toBeTruthy();

    const before = await funnelTop(cookie!);
    const unscopedBefore = (
      await env.DB.prepare("SELECT count(*) n FROM decks WHERE edition = 'incubator'").first<{ n: number }>()
    )!.n;

    // Three more decks for tenant B, in the same edition and the same status as
    // the seeded ones — indistinguishable from this customer's own rows to any
    // query whose only predicate is `edition`.
    for (const n of [1, 2, 3]) {
      await env.DB.prepare(
        "INSERT INTO decks (id, tenant_id, edition, name, status) VALUES (?, ?, 'incubator', ?, 'new')",
      )
        .bind(`zz_funnel_${n}`, TENANT_B, `${MARKER} Funnel ${n}`)
        .run();
    }

    try {
      // The control FIRST: if the unscoped number did not move, the rows are not
      // there and the assertion below would pass for the wrong reason.
      const unscopedAfter = (
        await env.DB.prepare("SELECT count(*) n FROM decks WHERE edition = 'incubator'").first<{ n: number }>()
      )!.n;
      expect(
        unscopedAfter - unscopedBefore,
        "the three tenant-B decks are not in the table, so this test proves nothing",
      ).toBe(3);

      const after = await funnelTop(cookie!);
      expect(
        after,
        `GET /api/analytics/funnel moved from ${before} to ${after} when ANOTHER customer ` +
          "uploaded three decks. Every number on that screen is a count, so nothing in the " +
          "response would have said so.",
      ).toBe(before);
    } finally {
      await env.DB.prepare("DELETE FROM decks WHERE id LIKE 'zz_funnel_%'").run();
    }
  });

  it("the cohort report's mean score does not move when another customer scores a deck", async () => {
    // `humanEvalsByDeck` feeds three reports. `zz_eval` carries 9.9 — above every
    // seeded score — so a leaking mean rises and a scoped one does not. This case
    // then MOVES that mean and requires the report not to notice.
    const cookie = await login(ADMIN);
    expect(cookie).toBeTruthy();
    const read = async () => {
      const { status, text } = await body("/api/analytics/cohort", cookie!);
      expect(status).toBe(200);
      return JSON.parse(text) as { decks?: { finalScore: number | null }[] };
    };
    const before = await read();

    // 1.0, NOT another 9.9. Measured 2026-09-30: with a second 9.9 on the same
    // deck the mean stayed 9.9, the response body was byte-identical, and the case
    // passed against a completely unscoped `analytics.ts`. A control whose
    // "before" and "after" cannot differ is not a control. 1.0 against 9.9 moves
    // tenant B's mean to 5.45, so an unscoped read changes.
    await env.DB.prepare(
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, submitted_at) " +
        "VALUES ('zz_eval_2', 'zz_deck', 'zz_jury', 1.0, datetime('now'))",
    ).run();
    try {
      const unscoped = (
        await env.DB.prepare(
          "SELECT count(*) n FROM evaluations WHERE weighted_total IS NOT NULL",
        ).first<{ n: number }>()
      )!.n;
      expect(unscoped, "no evaluations at all, so a mean cannot be tested").toBeGreaterThan(1);
      const after = await read();
      // The whole report, not one field: the ranking, the counts and the means are
      // all taken from the same row set, so comparing the serialised body catches a
      // leak into any of them.
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    } finally {
      await env.DB.prepare("DELETE FROM evaluations WHERE id = 'zz_eval_2'").run();
    }
  });
});

describe("tenancy · layer 3 — the writes, where the failure is silent", () => {
  it("a row created through the API as tenant B still lands in tenant A (pending — T1-COMMERCE)", async () => {
    const cookie = await login(`zz.admin@${MARKER.toLowerCase()}.test`);
    expect(cookie).toBeTruthy();
    const res = await SELF.fetch(`${BASE}/api/tickets`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/json" },
      body: JSON.stringify({ subject: `${MARKER} write probe`, body: "created as tenant B" }),
    });
    // The route may not exist with this shape; what matters is that if a row WAS
    // written, it belongs to tenant B.
    const row = await env.DB.prepare(
      "SELECT tenant_id FROM tickets WHERE subject = ?",
    )
      .bind(`${MARKER} write probe`)
      .first<{ tenant_id: string }>();
    if (!row) {
      expect(
        res.status,
        "POST /api/tickets wrote nothing, so the write side is untested — adjust the probe",
      ).not.toBe(200);
      return;
    }
    // MEASURED, 2026-09-30: it lands in `t_default`. `routes/support.ts`'s INSERT
    // names no tenant, so the `DEFAULT 't_default'` on the column takes effect and
    // tenant B's ticket is filed against tenant A — with a 200 and a row, and
    // nothing in the response to notice. This is the silent half of the wave and it
    // is asserted here as the PENDING fact, so T1-COMMERCE's fix fails this case
    // and promotes it.
    expect(
      row.tenant_id,
      "POST /api/tickets NO LONGER mis-tenants its write — T1-COMMERCE has scoped the INSERT. " +
        `Change this expectation to TENANT_B and delete this comment.`,
    ).toBe(TENANT_A);
  });

  it("an audit row written as tenant B is filed against tenant B (T1-REPORTS)", async () => {
    // `recordAudit` named no `tenant_id`, so the column's `DEFAULT 't_default'`
    // filed EVERY audit row in the product against the first customer. On a trail
    // that is not merely a misplaced row: tenant A's log would show tenant B's
    // administrator changing tenant A's settings. `PUT /api/audit/retention`
    // records a `security` row, so it exercises the writer end to end.
    const cookie = await login(`zz.admin@${MARKER.toLowerCase()}.test`);
    expect(cookie).toBeTruthy();
    const res = await SELF.fetch(`${BASE}/api/audit/retention`, {
      method: "PUT",
      headers: { cookie: cookie!, "content-type": "application/json" },
      // 3650 days keeps everything, so the purge in the same request deletes
      // nothing and this test cannot destroy another case's fixtures.
      body: JSON.stringify({ retentionDays: 3650 }),
    });
    expect(res.status, await res.text()).toBe(200);

    const row = await env.DB.prepare(
      "SELECT tenant_id, edition FROM audit_log WHERE action = 'audit_retention_changed' ORDER BY created_at DESC LIMIT 1",
    ).first<{ tenant_id: string; edition: string }>();
    expect(row, "no audit row was written, so the write side is untested").toBeTruthy();
    expect(row!.tenant_id).toBe(TENANT_B);
    expect(row!.edition).toBe("incubator");
  });

  it("setting a retention window touches only the caller's workspace (T1-REPORTS)", async () => {
    // The sharpest shape in `audit/log.ts`: `UPDATE org_settings … WHERE edition = ?`
    // set every customer's window from one console, and `purgeExpiredAudit` then
    // DELETED on it. Not a leak — a destruction, on someone else's schedule, with
    // an ordinary row count in the response. Depends on the request above having
    // set tenant B to 3650.
    const a = await env.DB.prepare(
      "SELECT audit_retention_days AS d FROM org_settings WHERE tenant_id = ? AND edition = 'incubator'",
    )
      .bind(TENANT_A)
      .first<{ d: number | null }>();
    const b = await env.DB.prepare(
      "SELECT audit_retention_days AS d FROM org_settings WHERE tenant_id = ? AND edition = 'incubator'",
    )
      .bind(TENANT_B)
      .first<{ d: number | null }>();
    expect(b!.d, "tenant B's window was not set, so this case proves nothing").toBe(3650);
    expect(
      a!.d,
      "tenant B's admin set tenant A's audit retention window — and the purge runs on it",
    ).not.toBe(3650);
  });

  it("the migration chain's own integrity assertions all passed", async () => {
    // `0088` and `0100` write their verdicts here; the CHECK on the column means a
    // failing one could never have been committed. Reading them back proves the
    // chain actually ran the assertions rather than skipping them.
    const { results } = await env.DB.prepare(
      "SELECT id, verdict FROM _tenancy_assert ORDER BY id",
    ).all<{ id: string; verdict: string }>();
    expect(results.length).toBeGreaterThanOrEqual(12);
    for (const row of results) expect(row.verdict, row.id).toBe("ok");
  });
});
