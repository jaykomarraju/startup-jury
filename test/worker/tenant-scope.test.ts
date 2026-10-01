import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import {
  emitNotification,
  resolveNotificationPreferences,
  sendEmail,
} from "../../src/server/email/outbox";
import { runMonthlyUsageSummary } from "../../src/server/scheduled";
import type { Env } from "../../src/server/types";
import {
  TENANT_KEYED_TABLES,
  TENANT_OWNER,
  PLATFORM_GLOBAL_TABLES,
  scoped,
  type TenantScope,
} from "../../src/shared/tenant";
import { mintResubmitToken } from "../../src/server/resubmit";

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
/**
 * The VC edition's admin. `/api/diligence` is VC-only — its router answers 403
 * `wrong_edition` to anyone else — so §2 B14, the term-sheet and legal-DD
 * surface, cannot be probed with an incubator principal at all. T1-ESIGN.
 */
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";

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
    // TWO rows in one statement — the registry assertion below requires exactly one
    // entry per TABLE, so the second row rides along here rather than inventing a key.
    //
    // `zz_jury` exists because §2 B7 (`GET /api/evaluators`, `GET /api/jury`) filters
    // `users` to the EVALUATOR roles, and `zz_admin` is an admin — which is the whole
    // of the old `unprobed` reason for that probe: "filters `users` to evaluator roles
    // and `zz_admin` is an admin — needs a tenant-B jury row". Without it those two
    // routes could leak the entire roster and the marker sweep would see nothing.
    // Measured 2026-09-30: with this row and the predicate reverted to `edition = ?`,
    // `/api/evaluators` returns `ZZTENANTB Juror`. T1-DECKS.
    sql:
      "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash) " +
      // The same password hash as the seeded demo accounts, so tenant B's admin
      // can actually sign in — which is what Layer 3 needs.
      "SELECT 'zz_admin', ?, ? , 'zz.admin@" + MARKER.toLowerCase() + ".test', 'admin', 'incubator', 'ZZ', password_hash " +
      "FROM users WHERE email = '" + ADMIN + "' " +
      "UNION ALL " +
      "SELECT 'zz_jury', ?, ?, 'zz.juror@" + MARKER.toLowerCase() + ".test', 'jury', 'incubator', 'ZJ', password_hash " +
      "FROM users WHERE email = '" + ADMIN + "'",
    binds: [TENANT_B, `${MARKER} Admin`, TENANT_B, `${MARKER} Juror`],
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
    // TWO rows, one per edition, in one statement — `TENANT_B_FIXTURES` is keyed
    // by TABLE and the registry assertion above requires exactly one entry per
    // table, so the VC row rides along here rather than inventing a key.
    //
    // It is needed because the agreements library is reached from two different
    // routers under two different editions: `/api/esign/templates` (§2 B15,
    // either edition) and `/api/diligence/templates` (§2 B14, VC only, and until
    // T1-ESIGN the predicate there was the LITERAL `edition = 'vc'`). An
    // incubator-only fixture leaves the B14 surface untestable, which is how the
    // highest-value table in the schema ends up with a green suite and no
    // coverage.
    sql:
      "INSERT INTO agreement_templates (id, tenant_id, edition, code, name) VALUES " +
      "('zz_tmpl', ?, 'incubator', ?, ?), ('zz_tmpl_vc', ?, 'vc', ?, ?)",
    binds: [
      TENANT_B,
      `${MARKER}_nda`,
      `${MARKER} NDA`,
      TENANT_B,
      `${MARKER}_term_sheet`,
      `${MARKER} Term Sheet`,
    ],
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
    // **`connection_id` is tenant A's `crm_inc_hubspot`, deliberately, and that
    // is not a contrivance.** CRM connection ids are DETERMINISTIC —
    // `crm_<edition>_<provider>` in `0037`'s seed and in `crm/store.ts`'s
    // `blankRow` — not UUIDs, so under tenancy two customers' hubspot
    // connections genuinely carry the same id until the seed is re-keyed.
    // `0098` rebuilt `crm_connections` for `UNIQUE (tenant_id, edition,
    // provider)` precisely because of that.
    //
    // It is also what makes §2 B19 probeable at last. With the id pointing at
    // `zz_crm`, nothing a tenant-A admin can ask for ever reaches this row —
    // which is what the old `unprobed` note recorded. Pointing it at the shared
    // id makes `GET /api/crm/hubspot/log` return it the moment `listSyncLog`
    // stops binding the tenant. Measured both ways; see the probe below.
    sql:
      "INSERT INTO crm_sync_log (id, tenant_id, connection_id, edition, provider, direction, operation, status, error) " +
      "VALUES ('zz_csl', ?, 'crm_inc_hubspot', 'incubator', 'hubspot', 'pull', 'deal_import', 'ok', ?)",
    binds: [TENANT_B, `${MARKER} synced`],
  },
  resubmit_tokens: {
    sql:
      "INSERT INTO resubmit_tokens (id, tenant_id, deck_id, edition, token_hash, expires_at) " +
      "VALUES ('zz_tok', ?, 'zz_deck', 'incubator', ?, datetime('now', '+7 days'))",
    binds: [TENANT_B, `${MARKER}_hash`],
  },
  email_outbox: {
    // T1-PEOPLE — `deck_id` added, and it is what makes this table PROBEABLE
    // rather than merely keyed. `GET /api/notifications/outbox` resolved an edition
    // through `COALESCE(d.edition, u.edition)` and failed CLOSED, so a row with no
    // deck and a non-user recipient dropped out of the log whatever its tenant —
    // the marker could never reach the response, and an isolation case over it
    // would have asserted nothing. Hung off `zz_deck` (tenant B, incubator), the
    // COALESCE resolves to `incubator` and the row DID reach a tenant-A incubator
    // admin before the tenant predicate was added. Measured both ways; see the
    // `B21 outbox` probe.
    sql:
      "INSERT INTO email_outbox (id, tenant_id, deck_id, kind, to_email, subject, body) " +
      "VALUES ('zz_eo', ?, 'zz_deck', 'founder_query', ?, ?, ?)",
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
 * **TENANT B's PROXY ROWS — the tables with no tenant column of their own.**
 *
 * `TENANT_B_FIXTURES` above is keyed by table and the registry assertion requires it
 * to equal `TENANT_KEYED_TABLES` exactly, so a proxy table cannot go in it. But the
 * extension note at the top of this file names the need outright — "a `queries` /
 * `calls` / `signups` row hanging off `zz_deck`" — because several `unprobed` probes
 * are unprobeable for exactly one reason: tenant B owns a deck and nothing under it.
 *
 * These are the 33 tables of §5b's scoped-by-proxy bucket, where §11's first standing
 * instruction says the silent failures will be. Each row hangs off `zz_deck`, so it
 * belongs to tenant B through `TENANT_OWNER` and through nothing else: there is no
 * column on these rows for a predicate to bind, which is precisely why a route that
 * forgets the owner join returns them.
 *
 * Added by T1-DECKS for `queries` (§2 B3), and by T1-FLOW for the five below.
 * Other sessions: add yours here with the probe it makes real, and keep the
 * dependency order honest — `Object.entries` seeds in declaration order.
 *
 * **A fixture here can turn another session's `unprobed` case into a REAL leak,
 * and that is the point of adding one.** When it does, move that case to
 * `pending` with its owner rather than deleting it — the owner then has a
 * negative control instead of a case that could never have failed. T1-REPORTS'
 * `evaluations` row did exactly that to `B7 evaluators`.
 *
 * INTEGRATION NOTE: T1-REPORTS independently declared this same const as an
 * ARRAY of `{id, sql, binds}`, including a `zz_jury` row that `TENANT_B_FIXTURES
 * .users` above already writes. Seeding both would have failed `beforeAll` on a
 * duplicate primary key. The map won because its registry assertion — every key
 * is a table with NO `tenant_id` column, and every row resolves to tenant B
 * through `viaParent` — is stronger than counting ids; T1-REPORTS' two rows that
 * were not already present were folded in below.
 */
const TENANT_B_PROXY_FIXTURES: Readonly<Record<string, Fixture>> = {
  queries: {
    // §2 B3 — "every clarification question and founder response". `GET /api/queries`
    // reads `queries JOIN decks`, and the join carried `d.edition = ?` only. The
    // MARKER is in `questions`, which is the letter's own text.
    sql:
      "INSERT INTO queries (id, deck_id, questions, email_status, founder_response, created_at) " +
      "VALUES ('zz_query', 'zz_deck', ?, 'sent', ?, datetime('now'))",
    binds: [`${MARKER} — what is your runway?`, `${MARKER} responded: 14 months`],
  },

  // ── T1-FLOW (§2 B11, B12, B13) ──────────────────────────────────────────
  //
  // Four route probes were `unprobed` for want of exactly these rows: "tenant B
  // has no `calls` row", "tenant B has no `signups` row". They hang off
  // `ZZ_SIGNUP_DECK` (see `beforeAll`) rather than `zz_deck`, because
  // `GET /api/signups` lists only decks at `signup` / `onboard_ready` and
  // `zz_deck` is T1-DECKS' probe subject at `status = 'new'`.
  signups: {
    sql: `INSERT INTO signups (id, deck_id, status) VALUES ('zz_signup', '${"zz_deck_signup"}', 'progress')`,
  },
  signup_documents: {
    // §2 B12's actual stake is the founder's legal paperwork. The MARKER rides
    // on the item NAME, which is what both the pipeline summary and the admin
    // console's document set render.
    sql:
      "INSERT INTO signup_documents (id, signup_id, required_document_id, name, status, sort_order) " +
      "VALUES ('zz_sd', 'zz_signup', 'zz_rd', ?, 'submitted', 1)",
    binds: [`${MARKER} Incorporation certificate`],
  },
  cohorts: {
    // Hangs off `zz_prog`, not off a deck: `TENANT_OWNER` scopes a cohort
    // through its PROGRAMME, which is the one proxy path in this file that does
    // not end at `decks`.
    sql:
      "INSERT INTO cohorts (id, program_id, name, seat_capacity, seats_filled) " +
      "VALUES ('zz_coh', 'zz_prog', ?, 10, 1)",
    binds: [`${MARKER} Cohort 1`],
  },
  calls: {
    sql:
      "INSERT INTO calls (id, deck_id, kind, scheduled_at, title, status, ics_uid) " +
      "VALUES ('zz_call', 'zz_deck', 'intro', '2099-01-01T10:00:00.000Z', ?, 'scheduled', 'zz_call@startup-jury')",
    binds: [`${MARKER} intro call`],
  },
  call_participants: {
    // §2 B11's stake, and the reason it matters more than its size suggests:
    // `POST /api/calls/:id/invite` MAILS these addresses.
    sql:
      "INSERT INTO call_participants (id, call_id, user_id, email, name, kind) " +
      "VALUES ('zz_cpt', 'zz_call', NULL, ?, ?, 'founder')",
    binds: [`founder@${MARKER.toLowerCase()}.test`, `${MARKER} Founder`],
  },
  // ── T1-REPORTS (§2 B4, and the aggregates) ──────────────────────────────
  evaluations: {
    // Scoped only through `decks`, and what `humanEvalsByDeck` reads for three
    // incubator reports. 9.9 is deliberately far above any seeded score, so a
    // leaking MEAN moves visibly rather than by a rounding step. `zz_jury` is
    // seeded by `TENANT_B_FIXTURES.users` above, not here.
    sql:
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at) " +
      "VALUES ('zz_eval', 'zz_deck', 'zz_jury', 9.9, 'advance', ?, datetime('now'))",
    binds: [`${MARKER} remarks`],
  },
  pipeline_events: {
    // What `GET /api/activity` reads, and without it that probe could not have
    // failed: the route returns the DECK NAME from the joined `decks` row, so one
    // event on `zz_deck` puts `ZZTENANTB Startup` in an unscoped response.
    sql:
      "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note) " +
      "VALUES ('zz_pe', 'zz_deck', 'zz_admin', 'new', 'shortlisted', 'stage_changed', ?)",
    binds: [`${MARKER} moved to shortlisted`],
  },
};

/**
 * A SECOND tenant-B deck, at the stage the sign-up pipeline lists.
 *
 * It fits in neither map above, and both exclusions are deliberate rather than
 * an oversight: `TENANT_B_FIXTURES` is asserted to hold exactly one entry per
 * tenant-keyed table, and `TENANT_B_PROXY_FIXTURES` is asserted to hold only
 * tables with NO `tenant_id` column. A second row on a keyed table is neither,
 * so it is seeded on its own, named, and asserted below.
 *
 * It exists because `GET /api/signups` lists only decks at `signup` or
 * `onboard_ready`, and `zz_deck` is T1-DECKS' probe subject at `status = 'new'`.
 * Moving `zz_deck` to make one probe work would quietly change what another
 * session's probe measures.
 */
const ZZ_SIGNUP_DECK = "zz_deck_signup";

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
  // T1-DECKS. This is the measurement at the top of this file: a second accelerator
  // with zero decks saw all 15 of the first's, with founder names, emails and phones.
  // The only scope was `d.edition = ?` (`routes/decks.ts:480`); it is now
  // `scoped(scopeOf(user)).on("d")`, and the by-id routes behind it — `/:id`,
  // `/:id/report`, `/:id/versions`, `/:id/file` — go through `oneDeck()`.
  { id: "B1 decks", path: "/api/decks", as: PM, status: "enforced" },
  // T1-REPORTS. `/api/audit` returns the trail AND the actor list, so this one
  // probe covers both of `audit/log.ts`'s union branches and `listAuditActors`'s
  // two. Measured before the fix: the response carried `ZZTENANTB transferred
  // ownership` — an `ownership_transferred` row, §2's own example.
  { id: "B5 audit", path: "/api/audit", as: ADMIN, status: "enforced" },
  { id: "B6 users", path: "/api/users", as: ADMIN, status: "enforced" },
  // T1-CONFIG. Both of these read `parameters`, which 0089 keyed on
  // `(tenant_id, edition)`; the loaders now take a `TenantScope`.
  { id: "B9 config parameters", path: "/api/config/parameters", as: ADMIN, status: "enforced" },
  { id: "B9 config summary", path: "/api/config/summary", as: ADMIN, status: "enforced" },
  { id: "B15 esign templates", path: "/api/esign/templates", as: ADMIN, status: "enforced" },
  { id: "B15 esign signatories", path: "/api/esign/signatories", as: ADMIN, status: "enforced" },
  // §2 B14, which had no probe at all — the single highest-value row in the leak
  // table ("Term sheets, valuations, ownership percentages, legal and investment
  // DD") and the one whose predicate was a LITERAL. VC-only, so it needs the VC
  // principal and the VC half of the `agreement_templates` fixture.
  { id: "B14 diligence templates", path: "/api/diligence/templates", as: VC_ADMIN, status: "enforced" },
  // §2 B19. Promoted out of `unprobed` the way this file's instruction 1b asks:
  // the fixture was given a row the route can actually return FIRST, the case
  // was watched to fail as a real leak, and only then was the route scoped. The
  // old probe pointed at `/api/crm`, which cannot leak whatever the predicate
  // says — `listConnections` projects `CRM_PROVIDERS.map(…find…)`, so a second
  // customer's row is shadowed by the seeded one rather than returned. The log
  // endpoint returns the row set itself, and is where the leak was measurable.
  { id: "B19 crm sync log", path: "/api/crm/hubspot/log", as: ADMIN, status: "enforced" },
  { id: "B16 billing", path: "/api/billing", as: ADMIN, status: "enforced" },
  { id: "B17 seats", path: "/api/seats", as: ADMIN, status: "enforced" },
  // T1-PEOPLE — NEW. The delivery log names every recipient the workspace has
  // mailed, which is why it is admin-only; unscoped it named every OTHER
  // customer's recipients in the same edition too. Reachable only because the
  // `email_outbox` fixture above now hangs off `zz_deck` — see its comment.
  { id: "B21 outbox", path: "/api/notifications/outbox", as: ADMIN, status: "enforced" },
  { id: "B18 account", path: "/api/account", as: ADMIN, status: "enforced" },
  { id: "B20 tickets", path: "/api/tickets", as: ADMIN, status: "enforced" },
  { id: "B20 messages", path: "/api/messages", as: ADMIN, status: "enforced" },
  // T1-COMMERCE adds the third router in §2 B20's family. It was not on the
  // original worklist and it leaks the same way the other two did — one flat
  // edition-keyed pool, `support.ts:133` — so it is listed rather than left to be
  // noticed later.
  { id: "B20 issues", path: "/api/issues", as: ADMIN, status: "enforced" },
  // T1-FLOW. Measured leaking at `edition`-only scope (programme names and FUND
  // SIZE); `scoped().on("p")` and the cohort join through `TENANT_OWNER` close it.
  { id: "B24 programs", path: "/api/programs", as: ADMIN, status: "enforced" },
  // Both of these read as unprobeable at the path the leak table names and leak at
  // the path the console actually calls. Measured, not assumed: `/api/config/sectors`
  // does not exist (the sectors list is served inside `GET /api/config`) and
  // signup-config's documents live at `/documents`, not at the router root. A probe
  // pointed at a 404 proves nothing, which is why the `status !== 200` guard above
  // fails loudly instead of passing quietly.
  { id: "B9 config sectors", path: "/api/config", as: ADMIN, status: "enforced" },
  // ── T1-CONFIG's three unlisted routes. §2 B24 names `/api/questions` (6),
  //    `/api/ai-prompts` (5) and `/api/anchors` (2) in one row and the leak table
  //    gives them no probe; all three read `parameters`, so the `zz_param` fixture
  //    reaches every one of them. Each was MEASURED leaking on T0's commit before
  //    being written here as `enforced`.
  { id: "B24 ai prompts", path: "/api/ai-prompts", as: ADMIN, status: "enforced" },
  { id: "B24 question bank", path: "/api/questions", as: ADMIN, status: "enforced" },
  { id: "B24 rubric anchors", path: "/api/anchors", as: ADMIN, status: "enforced" },
  // T1-FLOW. The checklist (`required_documents`, tenant-owned) AND the per-record
  // document sets (`signups` + `signup_documents`, two hops) in one payload.
  { id: "B13 signup-config documents", path: "/api/signup-config/documents", as: ADMIN, status: "enforced" },

  // ── measured NOT to leak, and in every case because the marker cannot reach
  //    the response — never because the route is scoped. Each needs the named
  //    fixture before it can test anything. ──────────────────────────────────
  // T1-DECKS. Was `unprobed` for want of a row; `TENANT_B_PROXY_FIXTURES.queries`
  // supplies it. NEGATIVE CONTROL, measured 2026-09-30: with the fixture in place and
  // the predicate back to `WHERE d.edition = ?`, this probe returns
  // `ZZTENANTB — what is your runway?` AND the founder's reply. Scoped on the existing
  // `JOIN decks d` (not via `viaParent`, which would emit a second join).
  { id: "B3 queries", path: "/api/queries", as: PM, status: "enforced" },
  // T1-REPORTS. Was `unprobed` for exactly the reason recorded — tenant B had no
  // `pipeline_events` row — so `TENANT_B_PROXY_FIXTURES` supplies `zz_pe` FIRST,
  // the case was watched failing as a real leak, and only then was the route
  // scoped. Promoting it straight to `enforced` would have asserted nothing.
  { id: "B4 activity", path: "/api/activity", as: ADMIN, status: "enforced" },
  // T1-DECKS. Was `unprobed` because the route filters to evaluator roles and
  // `zz_admin` is an admin; `TENANT_B_FIXTURES.users` now also writes `zz_jury`.
  // NEGATIVE CONTROL, measured 2026-09-30: with that row and `u.edition = ?` restored,
  // `/api/evaluators` returns `ZZTENANTB Juror` with their workload.
  { id: "B7 evaluators", path: "/api/evaluators", as: PM, status: "enforced" },
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
  // T1-FLOW. Promoted out of `unprobed` the way this file's instruction 1b asks:
  // `TENANT_B_PROXY_FIXTURES.calls` and `.call_participants` gave tenant B a call
  // and an attendee, the probe then showed a real leak at `d.edition = ?`, and the
  // predicate that closed it is `scoped().on("d")` plus a two-hop `viaParent` on
  // the participant read. The incubator PM is a scheduler, so this principal sees
  // the whole workspace's calls rather than only their own.
  { id: "B11 calls", path: "/api/calls", as: PM, status: "enforced" },
  // T1-FLOW. Same promotion: `ZZ_SIGNUP_DECK` plus
  // `TENANT_B_PROXY_FIXTURES.signups` / `.signup_documents` made it probeable,
  // and it leaked both ways — the listing returned tenant B's record, and
  // `ensureSignups` WROTE a `signups` row against tenant B's deck on tenant A's
  // read. Both are closed by scoping the `JOIN decks`.
  { id: "B12 signups", path: "/api/signups", as: ADMIN, status: "enforced" },
  {
    id: "B19 crm connections",
    path: "/api/crm",
    as: ADMIN,
    status: "unprobed",
    // T1-ESIGN has scoped the route (`crm/store.ts` `listConnections`), but the
    // marker still cannot reach this response and saying otherwise would be the
    // vacuous promotion this file warns about. The reason is structural, not a
    // missing fixture: the handler answers `CRM_PROVIDERS.map(provider =>
    // rows.find(r => r.provider === provider))`, so with or without a tenant
    // predicate a second customer's hubspot row is shadowed by the seeded one
    // and never rendered. The assertion that the predicate exists lives at
    // `B19 crm sync log` above, which returns the row set itself, and at
    // `crm-provider.test.ts`'s two negative controls.
    owner: "T1-INT",
    reason:
      "route is scoped; `listConnections` projects one row per provider via `.find()`, so a " +
      "second tenant's row is shadowed rather than returned — unprobeable by marker sweep BY SHAPE",
  },
  {
    id: "B21 notifications",
    path: "/api/notifications",
    as: ADMIN,
    status: "unprobed",
    // T1-PEOPLE has scoped this route and it STAYS `unprobed`, deliberately: this
    // response is structurally incapable of carrying a marker, so promoting it to
    // `enforced` would assert nothing — which is what this file's own extension
    // rules say about an `unprobed` case promoted without a fixture that makes it
    // visible. `readGrid` resolves a fixed ten-by-two vocabulary
    // (`NOTIFICATION_EVENTS` × `NOTIFICATION_CHANNELS`) into booleans, so tenant B's
    // `np` fixture — whose marker is in `event_key` — is filtered out before the
    // response is built, and a real leak here would move a BOOLEAN. There is no
    // fixture that fixes that; it needs an assertion of a different shape, and
    // "the workspace default a tenant inherits is their own" below is it.
    reason:
      "the response is a fixed event vocabulary resolved to booleans, so no marker can appear " +
      "in it at all. The preference leak is a boolean and is asserted directly instead — see " +
      "`tenancy · layer 2c`. The OUTBOUND half of §2 B21/B22 is also asserted there.",
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

  // T1-FLOW's second deck, before the proxy rows that hang off it.
  await env.DB.prepare(
    "INSERT INTO decks (id, tenant_id, edition, name, status, founder_email) " +
      `VALUES ('${ZZ_SIGNUP_DECK}', ?, 'incubator', ?, 'signup', ?)`,
  )
    .bind(TENANT_B, `${MARKER} Signing`, `signing@${MARKER.toLowerCase()}.test`)
    .run();

  // The proxy rows go LAST and unconditionally: every one of them references
  // `zz_deck`, which the loop above has just written, and none of them carries a
  // tenant column that a `blocked` transitional key could collide with.
  for (const [table, fixture] of Object.entries(TENANT_B_PROXY_FIXTURES)) {
    await env.DB.prepare(fixture.sql)
      .bind(...(fixture.binds ?? []))
      .run();
    proxySeeded.push(table);
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

  it("tenant B's second deck is tenant B's, and is at the stage the pipeline lists", async () => {
    // The one fixture row that belongs to neither map, asserted on its own so it
    // cannot drift into tenant A or out of the stage its probes depend on.
    const row = await env.DB.prepare(
      "SELECT tenant_id, status FROM decks WHERE id = ?",
    )
      .bind(ZZ_SIGNUP_DECK)
      .first<{ tenant_id: string; status: string }>();
    expect(row, `${ZZ_SIGNUP_DECK} was not seeded`).toBeTruthy();
    expect(row!.tenant_id).toBe(TENANT_B);
    expect(row!.status).toBe("signup");
  });

  it("tenant B's proxy rows exist and reach tenant B through TENANT_OWNER, not through a column", async () => {
    // A proxy fixture that landed but resolved to tenant A would make its probe
    // vacuous in the quietest possible way: the marker is in the database, the route
    // is scoped, and the case passes while proving nothing. So assert BOTH halves —
    // the row is there, and the owner path puts it in tenant B.
    expect(proxySeeded.length, "no proxy fixtures were seeded").toBeGreaterThan(0);
    for (const table of proxySeeded) {
      const hasColumn = await env.DB.prepare(
        "SELECT count(*) n FROM pragma_table_info(?) WHERE name = 'tenant_id'",
      )
        .bind(table)
        .first<{ n: number }>();
      expect(
        hasColumn!.n,
        `${table} carries tenant_id — it belongs in TENANT_B_FIXTURES, not in the proxy map`,
      ).toBe(0);
      const qb = scoped(B_SCOPE);
      const join = qb.viaParent(table, "c");
      const mine = (
        await env.DB.prepare(`SELECT count(*) n FROM ${table} c ${join} ${qb.whereClause()}`)
          .bind(...qb.binds)
          .first<{ n: number }>()
      )!.n;
      expect(mine, `${table}: tenant B's proxy row does not resolve to tenant B`).toBeGreaterThan(0);
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

/**
 * LAYER 2c — T1-PEOPLE. **The two leaks on this session's surface that Layer 2
 * cannot see, because neither of them is a row in a response.**
 *
 * Layer 2 signs in as tenant A and sweeps response bodies for a marker. That
 * catches a missing predicate on a list, which is most of the wave. It cannot
 * catch either of the findings §2 singles out on the notification surface:
 *
 *   · **B22 is OUTBOUND.** `emitNotification`'s fan-out chose its recipients with
 *     `SELECT ... FROM users WHERE edition = ? AND active = 1 AND <roles>` — no
 *     tenant — so one customer's deck event EMAILED every other customer's admins
 *     and PMs with the startup's name in the subject. There is no response to
 *     sweep: the evidence is a row in `email_outbox` addressed to somebody who
 *     should never have received it. §2 calls it "a leak that leaves the building"
 *     and it is the only one of its kind in the table.
 *
 *   · **The workspace preference default is a BOOLEAN.** `notification_preferences`
 *     holds a `user_id IS NULL` row per `(event, channel)` that every member of a
 *     workspace inherits. Keyed by `(edition, event_key, channel)` it was shared
 *     across customers, so one customer's admin turning an alert off turned it off
 *     for another customer's staff — and the only visible symptom is mail that
 *     stops arriving. A marker sweep is blind to it twice over: the value is a
 *     boolean, and the response resolves a fixed vocabulary that discards any
 *     event key it does not recognise.
 */
describe("tenancy · layer 2c — the outbound fan-out, and a leak that is one boolean", () => {
  const ZZ_JURY = `zz.jury@${MARKER.toLowerCase()}.test`;

  beforeAll(async () => {
    // Tenant B needs a PM of its own, because the audience for a deck event is a
    // role list and `zz_admin` alone cannot show that the fan-out picked the right
    // workspace rather than simply picking everybody.
    await env.DB.prepare(
      "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash, active) " +
        "SELECT 'zz_pm', ?, ?, ?, 'program_manager', 'incubator', 'ZP', password_hash, 1 " +
        "FROM users WHERE email = ? ON CONFLICT (tenant_id, email) DO NOTHING",
    )
      .bind(TENANT_B, `${MARKER} Manager`, ZZ_JURY, ADMIN)
      .run();
  });

  it("a deck event reaches ONLY the owning customer's staff, however it is called", async () => {
    // Called the way almost every producer calls it: an `edition` and a `deckId`,
    // and NO scope — because eight of the ten call sites are in four other T1
    // sessions' files and a required field would not compile there. The deck is
    // what resolves the tenant (`resolveTenant`), so this is the arm that closes
    // B22 for those callers ahead of their sessions.
    const key = `zz_fanout_${crypto.randomUUID()}`;
    const result = await emitNotification(env as unknown as Env, {
      event: "deck_submitted",
      edition: "incubator",
      deckId: "zz_deck",
      title: `${MARKER} Startup uploaded a deck`,
      dedupeKey: key,
    });

    const { results } = await env.DB.prepare(
      "SELECT o.to_email, o.tenant_id FROM email_outbox o WHERE o.dedupe_key LIKE ?",
    )
      .bind(`${key}:%`)
      .all<{ to_email: string; tenant_id: string }>();

    // It produced something, or the rest of this case is vacuous.
    expect(result.recipients, "the fan-out resolved nobody — this case proves nothing").toBeGreaterThan(0);
    expect(results.length).toBeGreaterThan(0);

    // Every recipient belongs to tenant B, and every row is filed against tenant B.
    const seeded = new Set(["zz.admin@" + MARKER.toLowerCase() + ".test", ZZ_JURY]);
    for (const row of results) {
      expect(
        seeded.has(row.to_email),
        `${row.to_email} received tenant B's deck event — §2 B22, the leak that leaves the building`,
      ).toBe(true);
      expect(row.tenant_id, "the outbox row was filed against the wrong customer").toBe(TENANT_B);
    }
    // And the seeded incubator admin — who IS in `deck_submitted`'s audience, and
    // who would have been mailed by the unscoped statement — was not.
    expect(results.some((r) => r.to_email === ADMIN)).toBe(false);
  });

  it("a mail with no deck and no scope is still filed somewhere, and says so in the log", async () => {
    // The third arm of `resolveTenant`, asserted rather than assumed: `crm_sync_failed`
    // (`crm/provider.ts`) and `invite_accepted` (`routes/auth.ts`) have neither a
    // scope nor a deck, so they land in `DEFAULT_TENANT_ID` with a `console.warn`.
    // Identical to today's behaviour while one customer exists; both are named in
    // `docs/parity-requests/T1-PEOPLE.md` as the two call sites still to thread.
    const sent = await sendEmail(env as unknown as Env, {
      kind: "founder_query",
      toEmail: "no.deck.no.scope@example.test",
      subject: "unscoped",
      body: "unscoped",
      dedupeKey: `zz_unscoped_${crypto.randomUUID()}`,
    });
    const row = await env.DB.prepare("SELECT tenant_id FROM email_outbox WHERE id = ?")
      .bind(sent.id)
      .first<{ tenant_id: string }>();
    expect(row?.tenant_id).toBe(TENANT_A);
  });

  it("an explicit scope beats a deck, so a cron pass cannot be re-tenanted by its data", async () => {
    const sent = await sendEmail(env as unknown as Env, {
      kind: "evaluator_reminder",
      scope: B_SCOPE,
      // A tenant-A deck id with a tenant-B scope is not a situation the product
      // creates; it is here to pin the PRECEDENCE, because the cron enumerates
      // workspaces and must not have its own pass re-pointed by a row it reads.
      deckId: "inc_deck_finstack",
      toEmail: `precedence@${MARKER.toLowerCase()}.test`,
      subject: "precedence",
      body: "precedence",
      dedupeKey: `zz_precedence_${crypto.randomUUID()}`,
    });
    const row = await env.DB.prepare("SELECT tenant_id FROM email_outbox WHERE id = ?")
      .bind(sent.id)
      .first<{ tenant_id: string }>();
    expect(row?.tenant_id).toBe(TENANT_B);
  });

  it("the workspace notification default a customer inherits is their own", async () => {
    // The boolean leak. Tenant B turns `credits_low` email OFF for its whole
    // workspace; tenant A must still be ON. Unscoped, `resolveNotificationPreferences`
    // read the `user_id IS NULL` row by `(edition, event_key, channel)` alone, so
    // tenant B's policy silenced tenant A's administrators — and the only symptom
    // is mail that stops arriving.
    await env.DB.prepare(
      "INSERT INTO notification_preferences (id, tenant_id, edition, user_id, event_key, channel, enabled) " +
        "VALUES ('zz_np_off', ?, 'incubator', NULL, 'credits_low', 'email', 0)",
    )
      .bind(TENANT_B)
      .run();

    const forA = await resolveNotificationPreferences(
      env as unknown as Env,
      A_SCOPE,
      "credits_low",
      ["inc_admin"],
    );
    const forB = await resolveNotificationPreferences(
      env as unknown as Env,
      B_SCOPE,
      "credits_low",
      ["zz_admin"],
    );
    expect(forB("zz_admin", "email"), "tenant B's own OFF did not take effect").toBe(false);
    expect(
      forA("inc_admin", "email"),
      "tenant B's workspace default silenced tenant A's administrators — the leak is one boolean",
    ).toBe(true);

    await env.DB.prepare("DELETE FROM notification_preferences WHERE id = 'zz_np_off'").run();
  });

  it("the monthly digest reaches every customer, with a key of their own", async () => {
    // §2 A8, at the key string, and the WORKSPACE LOOP that makes it matter.
    //
    // MEASURED CORRECTION, recorded here and at the call site: A8 says tenant B's
    // digest is "silently swallowed as a duplicate of tenant A's". It would not have
    // been. `emitNotification` appends `:${user.id}` to every per-recipient key and
    // `users.id` is globally unique, so the two customers' keys already differed —
    // the third assertion below pins that mechanism, because it is the only thing
    // that was holding. What WAS true is that the producer looped over the two
    // EDITIONS and the fan-out choosing recipients carried no tenant (§2 B22), so
    // each pass mailed every customer's administrators a report whose numbers were
    // summed across all of them. Not a lost digest: a wrong one, to the wrong people.
    await runMonthlyUsageSummary(env as unknown as Env, new Date("2026-03-05T08:00:00Z"));
    const { results } = await env.DB.prepare(
      "SELECT tenant_id, dedupe_key FROM email_outbox WHERE dedupe_key LIKE 'monthly_usage_summary:%'",
    ).all<{ tenant_id: string; dedupe_key: string }>();

    // 1. Both customers were reached. Fails if the producer loops over editions
    //    again instead of over `liveWorkspaces`.
    expect([...new Set(results.map((r) => r.tenant_id))].sort()).toEqual(
      [TENANT_A, TENANT_B].sort(),
    );

    // 2. Every key names the customer it belongs to. Fails the moment the key goes
    //    back to `monthly_usage_summary:${edition}:${month}`.
    for (const row of results) {
      expect(
        row.dedupe_key.startsWith(`monthly_usage_summary:${row.tenant_id}:`),
        `${row.dedupe_key} does not name its own customer — §2 A8`,
      ).toBe(true);
    }

    // 3. And the per-recipient suffix is still there, which is the fact the
    //    correction above rests on: `idx_outbox_dedupe ON email_outbox (dedupe_key)`
    //    is STILL globally unique (`0099` re-cut the `notifications` one and had no
    //    slot for this), so without a unique component no second customer could hold
    //    a row at all.
    for (const row of results) {
      expect(
        /:usr_|:inc_|:vc_|:zz_/.test(row.dedupe_key.slice("monthly_usage_summary:".length)),
        `${row.dedupe_key} carries no per-recipient component`,
      ).toBe(true);
    }
  });
});

describe("tenancy · layer 2 mirror — the same routes, from tenant B's own chair", () => {
  /**
   * **THE NEGATIVE CONTROL FOR AN `enforced` CASE.**
   *
   * `enforced` asserts an ABSENCE, and an absence has two explanations: the
   * route is scoped, or the marker could never have reached it. This file names
   * that hazard — `unprobed` exists because four probes answered 200 with no
   * marker and it meant nothing — but the hazard does not go away when a case is
   * promoted. A fixture that stops being returned for an unrelated reason (a
   * stage filter, a status CHECK, a route that moved) turns a green `enforced`
   * case into a test of nothing, silently, forever.
   *
   * So each promoted route is probed twice: once as tenant A, asserting the
   * marker is absent, and once as tenant B's OWN admin, asserting it is present.
   * The second direction is what proves the first one measured something. If a
   * fixture stops being reachable, this fails and says so instead of the
   * `enforced` case passing for the wrong reason.
   *
   * Added by T1-FLOW for its four routes. It generalises: any session promoting
   * a probe can add a line here.
   */
  const MIRROR_PROBES: readonly { id: string; path: string; expect: string }[] = [
    { id: "B24 programs", path: "/api/programs", expect: `${MARKER} Accelerator` },
    { id: "B11 calls", path: "/api/calls", expect: `${MARKER} intro call` },
    { id: "B12 signups", path: "/api/signups", expect: `${MARKER} Signing` },
    {
      id: "B13 signup-config documents",
      path: "/api/signup-config/documents",
      expect: `${MARKER} Document`,
    },
  ];

  /**
   * And the other half of the control, in SQL: the predicate these routes USED
   * to carry, run against the same rows.
   *
   * Both tenants are `edition = 'incubator'` on purpose — §2's whole argument is
   * that `edition` has two values and every customer shares a bucket — so an
   * `edition`-only predicate cannot separate them even in principle. This asserts
   * that rather than arguing it: the old shape returns tenant B's row, the new one
   * does not, and the difference is the `tenant_id` half.
   */
  const OLD_PREDICATE_PROBES: readonly {
    /** What the row is, for the test name. */
    id: string;
    /** The FROM clause as the product writes it, joins included. */
    from: string;
    /** The alias the workspace predicate attaches to — the keyed table's. */
    owner: string;
    /** How to pick out tenant B's one row. */
    row: string;
    rowId: string;
  }[] = [
    { id: "programs", from: "programs p", owner: "p", row: "p.id", rowId: "zz_prog" },
    {
      id: "cohorts (through its programme)",
      from: "cohorts ch JOIN programs p ON p.id = ch.program_id",
      owner: "p",
      row: "ch.id",
      rowId: "zz_coh",
    },
    {
      id: "calls (through its deck)",
      from: "calls c JOIN decks d ON d.id = c.deck_id",
      owner: "d",
      row: "c.id",
      rowId: "zz_call",
    },
    {
      id: "signups (through its deck)",
      from: "signups s JOIN decks d ON d.id = s.deck_id",
      owner: "d",
      row: "s.id",
      rowId: "zz_signup",
    },
    { id: "required_documents", from: "required_documents rd", owner: "rd", row: "rd.id", rowId: "zz_rd" },
  ];

  for (const probe of OLD_PREDICATE_PROBES) {
    it(`the edition-only predicate returned tenant B's row, the scoped one does not — ${probe.id}`, async () => {
      const count = `SELECT count(*) n FROM ${probe.from}`;
      const old = (
        await env.DB.prepare(`${count} WHERE ${probe.owner}.edition = ? AND ${probe.row} = ?`)
          .bind(A_SCOPE.edition, probe.rowId)
          .first<{ n: number }>()
      )!.n;
      expect(
        old,
        `${probe.id}: tenant B's row is not reachable by the OLD predicate either, so the ` +
          `scoped assertion below proves nothing — fix the fixture`,
      ).toBe(1);

      const q = scoped(A_SCOPE).on(probe.owner).and(`${probe.row} = ?`, probe.rowId);
      const now = (
        await env.DB.prepare(`${count} ${q.whereClause()}`)
          .bind(...q.binds)
          .first<{ n: number }>()
      )!.n;
      expect(now, `${probe.id}: the scoped predicate still returns tenant B's row`).toBe(0);
    });
  }

  for (const probe of MIRROR_PROBES) {
    it(`tenant B's own admin DOES see tenant B's row — ${probe.id}`, async () => {
      const cookie = await login(`zz.admin@${MARKER.toLowerCase()}.test`);
      expect(cookie, "tenant B's admin cannot sign in — this control proves nothing").toBeTruthy();
      const { status, text } = await body(probe.path, cookie!);
      expect(status, `${probe.path} answered ${status} for tenant B's own admin`).toBe(200);
      expect(
        text.includes(probe.expect),
        `${probe.id}: tenant B's own admin cannot see ${JSON.stringify(probe.expect)} at ` +
          `${probe.path}, so the matching "enforced" case is asserting an absence that was ` +
          `never reachable. Fix the fixture, not this assertion.`,
      ).toBe(true);
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
  it("a row created through the API as tenant B lands in tenant B", async () => {
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
    // PROMOTED by T1-COMMERCE. The pending fact this case recorded on 2026-09-30
    // was that `routes/support.ts`'s INSERT named no tenant, so the column's
    // `DEFAULT 't_default'` took effect and tenant B's ticket was filed against
    // tenant A — with a 200 and a row, and nothing in the response to notice. The
    // INSERT now goes through `insertScope()`, which cannot omit the column.
    //
    // This is the one assertion in the file that no read-side negative control
    // could ever have replaced: a mis-tenanted write produces a correct-looking
    // response and a row that is present, complete and in the wrong workspace.
    expect(row.tenant_id, "POST /api/tickets mis-tenanted its write").toBe(TENANT_B);
  });

  it("a resubmit token is minted into its DECK's workspace, not the default one (T1-FLOW)", async () => {
    // `resubmit_tokens` is tenant-OWNED and `0085` gave the column
    // `DEFAULT 't_default'`, so an INSERT that simply omitted it would file a
    // BEARER CREDENTIAL against the first customer — 200, row written, nothing
    // to notice. `mintResubmitToken` therefore reads the workspace out of
    // `decks` in the INSERT itself rather than taking it from the caller.
    const { id } = await mintResubmitToken(env as unknown as Env, {
      deckId: "zz_deck",
      edition: "incubator",
    });
    const row = await env.DB.prepare("SELECT tenant_id, edition FROM resubmit_tokens WHERE id = ?")
      .bind(id)
      .first<{ tenant_id: string; edition: string }>();
    expect(row!.tenant_id).toBe(TENANT_B);
    expect(row!.edition).toBe("incubator");
  });

  it("refuses to mint a token for a deck in another edition, rather than issuing a dead link", async () => {
    // The `edition` argument is no longer the source of the value; it is a
    // cross-check in the INSERT's WHERE. A caller naming the wrong one writes no
    // row, and a throw beats handing back a link its holder believes is live.
    await expect(
      mintResubmitToken(env as unknown as Env, { deckId: "zz_deck", edition: "vc" }),
    ).rejects.toThrow(/no deck/);
  });

  it("a token filed against the wrong customer opens NOTHING — it fails closed (T1-FLOW)", async () => {
    // The door this guards: a token row whose `tenant_id` disagrees with its
    // deck's. `mintResubmitToken` makes that unconstructible, so the only way to
    // test the redeem path's half of the guard is to construct it by hand — which
    // is also what a row mis-filed before this change looks like.
    const { token, id } = await mintResubmitToken(env as unknown as Env, {
      deckId: "zz_deck",
      edition: "incubator",
    });
    const live = await SELF.fetch(`${BASE}/api/resubmit/${token}`);
    expect(live.status, "the token does not work at all, so this proves nothing").toBe(200);
    expect(await live.text()).toContain(MARKER);

    await env.DB.prepare("UPDATE resubmit_tokens SET tenant_id = ? WHERE id = ?")
      .bind(TENANT_A, id)
      .run();
    const crossed = await SELF.fetch(`${BASE}/api/resubmit/${token}`);
    expect(
      crossed.status,
      "a resubmit token resolved a deck outside its own workspace — that is a " +
        "cross-customer door, not a leak",
    ).toBe(404);
    expect(await crossed.json()).toMatchObject({ error: "invalid_token" });

    await env.DB.prepare("UPDATE resubmit_tokens SET revoked = 1 WHERE deck_id = 'zz_deck'").run();
  });

  it("creating a colleague as tenant B lands in tenant B, with an address tenant A already uses (T1-PEOPLE)", async () => {
    // ── THE WRITE `0087` DEFERRED TO THIS SESSION, AND THE LOOKUP T0 LEFT ─────
    // `0087`'s header calls `POST /api/users`'s INSERT "the single worst silent
    // write in the schema, because that account then signs in and sees
    // everything", and records that it first shipped `tenant_id TEXT NOT NULL`
    // with no default so a forgotten bind would FAIL — then took the default
    // because the loud form reddened 109 tests in a file T0 does not own. The
    // loudness was explicitly moved HERE, and until this case existed nothing in
    // the suite caught it: measured, reverting the INSERT to name `edition` alone
    // left every test in this file green.
    //
    // The second half is `db.ts:59`'s deprecated `getUserByEmail`, the one call
    // site T0 left standing in `routes/users.ts`. Under `0001`'s global
    // `UNIQUE (email)` its 409 was right; under `0087`'s `UNIQUE (tenant_id,
    // email)` it refused tenant B the right to employ somebody tenant A employs —
    // §7 Q4's "two customers employing the same person is not an edge case; it is
    // the second customer" — and the 409 itself disclosed that the address exists
    // somewhere on the platform. So this case uses tenant A's ADMIN's address on
    // purpose: a 409 here is that bug, and a 200 is the fix.
    const cookie = await login(`zz.admin@${MARKER.toLowerCase()}.test`);
    expect(cookie).toBeTruthy();
    const res = await SELF.fetch(`${BASE}/api/users`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/json" },
      body: JSON.stringify({ name: `${MARKER} Colleague`, email: ADMIN, role: "jury" }),
    });
    expect(
      res.status,
      "tenant B could not employ a person tenant A already employs — the global email check is back",
    ).toBe(200);
    const created = await res.json<{ user: { id: string } }>();

    const row = await env.DB.prepare("SELECT tenant_id, edition FROM users WHERE id = ?")
      .bind(created.user.id)
      .first<{ tenant_id: string; edition: string }>();
    expect(
      row?.tenant_id,
      "POST /api/users filed tenant B's colleague against tenant A — the account would sign in " +
        "and see everything (migrations/0087's header)",
    ).toBe(TENANT_B);

    // And the roster each admin reads holds their own colleague and not the other's.
    const mine = await body("/api/users", cookie!);
    expect(mine.text).toContain(`${MARKER} Colleague`);
    const theirs = await body("/api/users", (await login(ADMIN))!);
    expect(theirs.text).not.toContain(`${MARKER} Colleague`);

    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(created.user.id).run();
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
