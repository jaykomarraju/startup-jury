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
    sql:
      "INSERT INTO decks (id, tenant_id, edition, name, status, founder_email, founder_phone) " +
      "VALUES ('zz_deck', ?, 'incubator', ?, 'new', ?, '+91 00000 00000')",
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
  { id: "B5 audit", path: "/api/audit", as: ADMIN, status: "pending", owner: "T1-REPORTS" },
  { id: "B6 users", path: "/api/users", as: ADMIN, status: "pending", owner: "T1-PEOPLE" },
  { id: "B9 config parameters", path: "/api/config/parameters", as: ADMIN, status: "enforced" },
  { id: "B9 config summary", path: "/api/config/summary", as: ADMIN, status: "enforced" },
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
  { id: "B9 config sectors", path: "/api/config", as: ADMIN, status: "enforced" },
  // ── T1-CONFIG's four unlisted routes. §2 B24 names `/api/questions` (6),
  //    `/api/ai-prompts` (5) and `/api/anchors` (2) in one row and the leak table
  //    gives them no probe; all three read `parameters`, so the `zz_param` fixture
  //    reaches every one of them. Each was MEASURED leaking on T0's commit before
  //    being written here as `enforced` — the three `pending` rows above failed with
  //    "NO LONGER LEAKS" on the same run, which is the same evidence arriving the
  //    other way round.
  { id: "B24 ai prompts", path: "/api/ai-prompts", as: ADMIN, status: "enforced" },
  { id: "B24 question bank", path: "/api/questions", as: ADMIN, status: "enforced" },
  { id: "B24 rubric anchors", path: "/api/anchors", as: ADMIN, status: "enforced" },
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
  {
    id: "B4 activity",
    path: "/api/activity",
    as: ADMIN,
    status: "unprobed",
    owner: "T1-REPORTS",
    reason: "reads `pipeline_events`, where tenant B has no row — needs one on `zz_deck`",
  },
  {
    id: "B7 evaluators",
    path: "/api/evaluators",
    as: PM,
    status: "unprobed",
    owner: "T1-DECKS",
    reason: "filters `users` to evaluator roles and `zz_admin` is an admin — needs a tenant-B jury row",
  },
  {
    id: "B8 analytics funnel",
    path: "/api/analytics/funnel",
    as: ADMIN,
    status: "unprobed",
    owner: "T1-REPORTS",
    reason:
      "returns counts, not names — the marker sweep is structurally blind here, which is §11's " +
      "whole point about aggregates. `AGGREGATE_PROBES` is the layer that can see this one.",
  },
  {
    id: "B10 permissions",
    path: "/api/permissions",
    as: ADMIN,
    status: "unprobed",
    owner: "T1-CONFIG",
    reason:
      "returns task ids and booleans, no free text — and `role_permissions` is one of the five " +
      "tables 0091-0095's transitional keys still block, so tenant B cannot have a row to leak. " +
      "T1-CONFIG has scoped both statements and the upsert now names the widened key " +
      "(`routes/permissions.ts`), but this case cannot be promoted until integration drops " +
      "0091's index and a tenant-B fixture becomes possible — promoting it now would assert " +
      "nothing, which is what `unprobed` exists to say.",
  },
  {
    id: "B9 config scoring",
    path: "/api/config/scoring",
    as: ADMIN,
    status: "unprobed",
    owner: "T1-CONFIG",
    reason:
      "every field is a number or a boolean. The one free-text path is `weightPreview`, which " +
      "carries deck NAMES and needs `zz_deck` to have both an `ai_score` and a human " +
      "`evaluations` row — tenant B has neither. Scoped by T1-CONFIG regardless " +
      "(`loadWeightPreview`, `loadScoringSettings`, `loadScoreVisibility`); the fixture that " +
      "would make it probeable belongs with T1-DECKS' evaluation rows.",
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
      // Tenant B owns exactly one deck and no evaluation data, so every
      // deck-owned proxy table must come back empty for tenant B. A path wired to
      // the wrong parent returns tenant A's rows here.
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

  /**
   * `loadSettings` AND `loadScoringSettings` — ASSERTED FROM TENANT B's SIDE,
   * BECAUSE A MARKER SWEEP FROM TENANT A's SIDE CANNOT SEE THEM.
   *
   * The six `enforced` route cases above all catch the `parameters` read, and they
   * were all confirmed red against unscoped source. They say **nothing** about the
   * `org_settings` and `org_scoring_settings` reads on the same routes, and the
   * reason is the third trap in T1-REPORTS' list: both are `.first()` over a
   * single-row predicate, and with the key `(tenant_id, edition)` and nothing
   * indexing `edition` alone, an UNSCOPED scan reaches the MIGRATION's `t_default`
   * row before any row this file inserts. So `/api/config` would withhold tenant
   * B's `ZZTENANTB system prompt` from tenant A by luck of insert order, with no
   * predicate at all, and the case would pass while proving nothing.
   *
   * Inverting the probe removes the luck. Signed in as tenant B's OWN admin, the
   * correct answer is tenant B's row — which an unscoped `.first()` cannot return,
   * because it reaches `t_default` first. A passing assertion here therefore
   * requires the predicate to work, in the one direction insert order cannot fake.
   *
   * This is a POSITIVE control and it is paired with the marker sweeps above, not a
   * replacement for them: together they cover both reads on these routes.
   */
  it("tenant B's own admin reads tenant B's org_settings, not the migration's row", async () => {
    const cookie = await login(`zz.admin@${MARKER.toLowerCase()}.test`);
    expect(cookie).toBeTruthy();
    const { status, text } = await body("/api/config", cookie!);
    expect(status, "/api/config refused tenant B's admin, so this case proves nothing").toBe(200);
    const json = JSON.parse(text) as { aiSystemPrompt?: string };
    // The fixture's own value. `t_default`'s prompt is the seed's, so the two cannot
    // be confused, and an unscoped read returns the seed's.
    expect(
      json.aiSystemPrompt,
      "tenant B's admin was served another workspace's org_settings row — `loadSettings` " +
        "is reading by edition alone and the scan reached the migration's row first",
    ).toBe(`${MARKER} system prompt`);
  });

  it("tenant B's own admin reads tenant B's scoring framework, not the migration's row", async () => {
    // Same shape, same reason, different table: `org_scoring_settings` was given
    // `ai_weight_pct = 11` by the fixture precisely because no seeded row holds it.
    // This is the only assertion in the file that can see `loadScoringSettings`'s
    // predicate — the framework response is all numbers and booleans, so the marker
    // sweep is structurally blind to it (`B9 config scoring` is `unprobed` for that
    // reason).
    const cookie = await login(`zz.admin@${MARKER.toLowerCase()}.test`);
    const { status, text } = await body("/api/config/scoring", cookie!);
    expect(status).toBe(200);
    const json = JSON.parse(text) as { scoring?: { aiWeightPct?: number } };
    expect(
      json.scoring?.aiWeightPct,
      "tenant B's admin was served another workspace's scoring framework — the AI pre-scoring " +
        "switch, the jury-visibility toggles and the shortlist floor all come from this row",
    ).toBe(11);
  });

  /**
   * T1-CONFIG's THREE `ON CONFLICT` SITES — `role_permissions`, `score_visibility`
   * and `seat_capabilities`.
   *
   * These three are the write side of the five tables
   * `BLOCKED_BY_TRANSITIONAL_KEY` names, and the usual Layer-3 shape does not fit
   * them: the probe cannot assert "the row landed in tenant B", because while
   * 0091-0093's transitional unique indexes stand, a second customer's row for a
   * key the seed already holds CANNOT exist. `0091`'s header says so, and says the
   * UNIQUE violation is the correct error for "T1 has not finished yet".
   *
   * So the assertion is the one that holds in BOTH worlds, before and after
   * integration drops those indexes: **tenant B's write never lands in tenant A.**
   * Either it is refused — loudly, naming the index — or it succeeds and belongs to
   * tenant B. What it must never do is succeed with a 200 and file itself against
   * the first customer, which is exactly what `tenant_id TEXT NOT NULL DEFAULT
   * 't_default'` makes the default outcome of a forgotten bind. That is why all
   * three upserts use `insertScope()` rather than two hand-written binds.
   *
   * Each case therefore records the three statuses explicitly, so a run says which
   * world it is in rather than passing silently in both.
   */
  it("tenant B's permission write never lands in tenant A (role_permissions)", async () => {
    const cookie = await login(`zz.admin@${MARKER.toLowerCase()}.test`);
    expect(cookie).toBeTruthy();
    const res = await SELF.fetch(`${BASE}/api/permissions`, {
      method: "PUT",
      headers: { cookie: cookie!, "content-type": "application/json" },
      body: JSON.stringify({ cells: [{ role: "program_manager", taskId: "upload", granted: false }] }),
    });
    // Whatever the outcome, no row of the FIRST customer's authorisation matrix may
    // carry tenant B's actor. `updated_by` is the only column that can name who
    // wrote a cell, which is why the audit note on the route matters here too.
    const strays = (
      await env.DB.prepare(
        "SELECT count(*) n FROM role_permissions WHERE tenant_id = ? AND updated_by = 'zz_admin'",
      )
        .bind(TENANT_A)
        .first<{ n: number }>()
    )!.n;
    expect(
      strays,
      "tenant B's PUT /api/permissions wrote into tenant A's matrix — the INSERT is missing " +
        "its tenant_id bind and the column's DEFAULT 't_default' took effect",
    ).toBe(0);
    if (res.status === 200) {
      // 0091's index is gone and the widened key resolved. The row must be tenant B's.
      const row = await env.DB.prepare(
        "SELECT tenant_id FROM role_permissions WHERE role = 'program_manager' AND task_id = 'upload' " +
          "AND updated_by = 'zz_admin'",
      ).first<{ tenant_id: string }>();
      expect(row?.tenant_id, "the write succeeded but no tenant-B row exists").toBe(TENANT_B);
    } else {
      // The transitional index refused it. Loud, and the correct error for today.
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("tenant B's grid write never flips tenant A's cell (seat_capabilities)", async () => {
    // `seat_capabilities` has no `updated_by`, so the invariant is stated on the
    // VALUE instead: tenant A's `(core, premium)` cell must read the same before and
    // after. A mis-tenanted upsert would overwrite it, and the grid decides who may
    // configure the rubric at all — so the damage is an authorisation change that
    // looks like a successful save.
    const cellOf = async () =>
      (
        await env.DB.prepare(
          "SELECT allowed FROM seat_capabilities WHERE tenant_id = ? AND edition = 'incubator' " +
            "AND param_set = 'core' AND tier = 'premium'",
        )
          .bind(TENANT_A)
          .first<{ allowed: number }>()
      )?.allowed ?? null;
    const before = await cellOf();
    expect(before, "tenant A has no (core, premium) cell, so this case proves nothing").not.toBeNull();

    const cookie = await login(`zz.admin@${MARKER.toLowerCase()}.test`);
    const res = await SELF.fetch(`${BASE}/api/ai-prompts/capability`, {
      method: "PUT",
      headers: { cookie: cookie!, "content-type": "application/json" },
      body: JSON.stringify({ set: "core", tier: "premium", allowed: before === 1 ? false : true }),
    });
    expect(
      await cellOf(),
      "tenant B's PUT /api/ai-prompts/capability moved tenant A's grid cell",
    ).toBe(before);
    if (res.status === 200) {
      const row = await env.DB.prepare(
        "SELECT allowed FROM seat_capabilities WHERE tenant_id = ? AND edition = 'incubator' " +
          "AND param_set = 'core' AND tier = 'premium'",
      )
        .bind(TENANT_B)
        .first<{ allowed: number }>();
      expect(row, "the write succeeded but no tenant-B cell exists").toBeTruthy();
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("tenant B's visibility write never lands in tenant A (score_visibility)", async () => {
    const cookie = await login(`zz.admin@${MARKER.toLowerCase()}.test`);
    const res = await SELF.fetch(`${BASE}/api/config/scoring-framework`, {
      method: "PUT",
      headers: { cookie: cookie!, "content-type": "application/json" },
      body: JSON.stringify({
        visibility: { incubator: { program_manager: { program_associate: false } } },
      }),
    });
    const strays = (
      await env.DB.prepare(
        "SELECT count(*) n FROM score_visibility WHERE tenant_id = ? AND updated_by = 'zz_admin'",
      )
        .bind(TENANT_A)
        .first<{ n: number }>()
    )!.n;
    expect(
      strays,
      "tenant B's scoring-framework save wrote visibility cells into tenant A's matrix",
    ).toBe(0);
    if (res.status === 200) {
      const row = await env.DB.prepare(
        "SELECT tenant_id FROM score_visibility WHERE updated_by = 'zz_admin'",
      ).first<{ tenant_id: string }>();
      // A 200 with no row at all is possible: the save drops cells naming a role the
      // matrix does not draw, and writes nothing when none survive.
      if (row) expect(row.tenant_id).toBe(TENANT_B);
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
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
