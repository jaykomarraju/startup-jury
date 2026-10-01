/**
 * TENANT SCOPING — ONE HELPER, USED BY SEVEN SESSIONS, WRITTEN BY NONE OF THEM
 * ===========================================================================
 *
 * The seven T1 sessions apply the same transformation **211 times across 51
 * files**. If each invents its own predicate the review surface is 211
 * judgements instead of one. This file is the one.
 *
 * ── WHY IT LIVES IN `src/shared/` AND ISSUES NO QUERY ────────────────────────
 *
 * `plan_multitenancy.md` §11 is explicit that `src/shared/` is excluded from the
 * wave because **no file there issues a query** — verified, `grep -rln
 * 'prepare(\|DB\.' src/shared/` returns nothing — and that the `edition` in those
 * twenty files is the PRODUCT VARIANT, not a customer key. This file keeps that
 * boundary: it builds SQL fragments and the binds that go with them, and it never
 * touches `D1Database`. It is the one addition to `src/shared/` the plan asks for,
 * and it is a pure function of its arguments like everything else there.
 *
 * ── WHAT A SCOPE IS ─────────────────────────────────────────────────────────
 *
 * A **workspace is the pair `(tenant_id, edition)`**, and both halves survive.
 * `edition` is not being replaced: it is also the product variant that decides
 * which features exist (`diligence.ts:69` answers 403 `wrong_edition`;
 * `pipeline.ts:955`, `:1006`; `config.ts:824`), and 25 `CHECK (edition IN (...))`
 * constraints plus `ROLES_BY_EDITION`, `NAV_BY_EDITION`, `PERMISSION_ROLES` and
 * four more maps are all dimensioned on its two values. Adding `tenant_id`
 * alongside leaves the 211 existing predicates **correct but insufficient**
 * rather than wrong — a failure a negative control can find, not one that
 * silently returns another customer's rows. See §5c.
 *
 * ── THE THREE SHAPES, EACH WITH A WORKED EXAMPLE ────────────────────────────
 *
 * **1. Direct column** — a table that carries `tenant_id` itself (the 28 of §5b
 * plus the two outbox tables; `TENANT_KEYED_TABLES` below is the list).
 *
 * ```ts
 * // routes/decks.ts, before — the ONLY scope on the highest-value data in the
 * // product, and the measured cause of the leak this wave exists for:
 * const where = ["d.edition = ?"];
 * const binds: unknown[] = [edition];
 * if (status) { where.push("d.status = ?"); binds.push(status); }
 * const sql = `SELECT ... FROM decks d WHERE ${where.join(" AND ")}`;
 * db.prepare(sql).bind(...binds);
 *
 * // after:
 * const q = scoped(scopeOf(user)).on("d");
 * if (status) q.and("d.status = ?", status);
 * const sql = `SELECT ... FROM decks d ${q.whereClause()}`;
 * db.prepare(sql).bind(...q.binds);
 * ```
 *
 * `and()` takes the fragment and its binds **together**, which is the point: a
 * predicate and its bind cannot drift apart, and that is the mistake a 211-site
 * sweep makes.
 *
 * **2. One-hop join** — a table scoped only through a parent. 33 tables are in
 * this position and §5b counted **69 `FROM <table>` sites in `src/server/` with
 * only 26 carrying a `JOIN`**. Forty-three reads of tenant-owned data with
 * nothing in the statement naming the owner.
 *
 * ```ts
 * // evaluations is reached by deck_id with no scope of its own (§2 B2):
 * const q = scoped(scope);
 * const sql = `SELECT e.* FROM evaluations e
 *              ${q.viaParent("evaluations", "e")}
 *              ${q.whereClause()}`;
 * db.prepare(sql).bind(...q.binds);
 * // → JOIN decks owner_e ON owner_e.id = e.deck_id
 * //   WHERE owner_e.tenant_id = ? AND owner_e.edition = ?
 * ```
 *
 * `viaParent` reads the owner out of `TENANT_OWNER` below rather than taking it
 * from the caller, so the question "what owns `signatures`?" is answered once,
 * here, and not thirty-three times. For `signatures` the answer is three hops —
 * `signatures → agreements → signups → decks`, the deepest path in the schema —
 * and the helper emits all three.
 *
 * **3. Aggregate** — the same predicate, but the dangerous one. A list that leaks
 * shows another customer's startup names and somebody notices; a `COUNT(*)` or an
 * `AVG(score)` that leaks returns a perfectly ordinary-looking number.
 * `routes/analytics.ts` has 77 `edition` mentions and is the largest
 * concentration of this shape in the codebase, which is why T1-REPORTS' low
 * weight is misleading.
 *
 * ```ts
 * // the mean score across a workspace's decks:
 * const q = scoped(scope);
 * const sql = `SELECT avg(s.score) AS mean FROM scores s
 *              ${q.viaParent("scores", "s")}
 *              ${q.whereClause()}`;
 * const { mean } = await db.prepare(sql).bind(...q.binds).first();
 * ```
 *
 * There is nothing special about the SQL. What is special is that an aggregate
 * has no row for a negative control to miss, so `test/worker/tenant-scope.test.ts`
 * asserts aggregates by VALUE against a second tenant's data rather than by
 * absence — see its `AGGREGATE_PROBES`.
 *
 * ── BIND ORDER, THE ONE RULE ────────────────────────────────────────────────
 *
 * The builder owns the WHERE clause and the binds in it, in call order. If a
 * statement carries binds EARLIER in the string — a CTE, a correlated subquery, a
 * value in the SELECT list — those go first:
 *
 * ```ts
 * db.prepare(sql).bind(...headBinds, ...q.binds, ...tailBinds);
 * ```
 *
 * `q.binds` is a fresh array each time it is read, so it cannot be mutated by
 * accident.
 *
 * ── THE WRITE SIDE, WHICH IS WHERE THE SILENT FAILURE IS ────────────────────
 *
 * A missing read predicate returns another customer's rows and a negative control
 * sees it. A missing `tenant_id` on an INSERT puts a row in the wrong customer's
 * workspace and **nothing looks wrong** — the response is a 201 and the row is
 * there. The 17 `ALTER TABLE` columns carry `DEFAULT 't_default'` because SQLite
 * offers no other way to backfill a NOT NULL column, so a forgotten bind on those
 * tables lands in the default tenant rather than failing.
 *
 * Use `insertScope()` so the column is never forgotten, and note that the eleven
 * REBUILT tables — `users` first among them — carry `tenant_id TEXT NOT NULL`
 * with **no default**, so on those a forgotten bind is a loud error. That
 * asymmetry is deliberate; `migrations/0084_tenant_id_pipeline.sql` explains it.
 *
 * ```ts
 * const t = insertScope(scope);               // { columns: "tenant_id, edition", … }
 * await db.prepare(
 *   `INSERT INTO decks (id, ${t.columns}, name, status) VALUES (?, ${t.placeholders}, ?, ?)`,
 * ).bind(id, ...t.binds, name, status).run();
 * ```
 */

import type { Edition } from "./roles";

/**
 * The one organisation that exists today. Every `tenant_id` added by migrations
 * 0083–0101 backfills to it, so the whole deployed database is this
 * organisation's data and nothing changes shape for anybody signing in now.
 *
 * It is a real row in `organizations`, not a sentinel: `0100`'s integrity
 * assertion fails the migration chain if any row in the 30 key-carrying tables
 * names a tenant that is not there.
 */
export const DEFAULT_TENANT_ID = "t_default";

/** A workspace: the customer, and which product variant of it. */
export interface TenantScope {
  readonly tenantId: string;
  readonly edition: Edition;
}

/**
 * The shape every scope is derived from. `SessionUser` satisfies it, and so does
 * any row carrying the two columns — which is what lets a cron job or a queue
 * consumer build a scope from the row it is processing rather than from a session
 * it does not have.
 */
export interface TenantPrincipal {
  readonly tenantId: string;
  readonly edition: Edition;
}

/**
 * The ONLY way a scope should be constructed in server code.
 *
 * It takes the principal, never a request parameter. §2's one piece of genuinely
 * good news is that **211 SQL predicates already bind a workspace key and not one
 * of them takes that key from the browser** — every one reads it from the
 * logged-in session. Keeping that true is the whole reason this function exists
 * instead of a two-field object literal: a `scopeOf(c.req.query())` would not
 * compile.
 */
export function scopeOf(principal: TenantPrincipal): TenantScope {
  return { tenantId: principal.tenantId, edition: principal.edition };
}

/**
 * The 30 tables that carry `tenant_id` as a column of their own: §5b's 28
 * tenant-owned tables, plus `email_outbox` and `esign_outbox`, which §5b counts
 * as scoped-by-proxy and which hold only NULLABLE foreign keys, so no join can
 * scope them (`migrations/0086_tenant_id_commerce.sql`).
 *
 * Exported as data because `test/worker/tenant-scope.test.ts` iterates it: a
 * table added here without an isolation case fails that test, and a table given
 * a column without being added here fails it too.
 */
export const TENANT_KEYED_TABLES = [
  "account_orders",
  "account_profiles",
  "agreement_templates",
  "audit_log",
  "authorised_signatories",
  "billing_invoices",
  "billing_payment_intents",
  "billing_subscriptions",
  "credit_ledger",
  "crm_connections",
  "crm_sync_log",
  "decks",
  "email_outbox",
  "esign_outbox",
  "messages",
  "notification_preferences",
  "notifications",
  "org_scoring_settings",
  "org_settings",
  "parameters",
  "programs",
  "required_documents",
  "resubmit_tokens",
  "role_permissions",
  "score_visibility",
  "seat_capabilities",
  "seat_grants",
  "sectors",
  "tickets",
  "users",
] as const;

export type TenantKeyedTable = (typeof TENANT_KEYED_TABLES)[number];

/**
 * The eight PLATFORM-GLOBAL tables. **Do not add a tenant key to these.** §3
 * measured five independent reasons the price catalogue is one book for the whole
 * product: `routes/pricing.ts` contains the string `edition` zero times (the only
 * one of the 25 route files at zero), none of these eight carries an `edition`
 * column, `CREATE UNIQUE INDEX pricing_versions_one_published ON pricing_versions
 * (status) WHERE status = 'published'` enforces one live catalogue product-wide,
 * every purchase path reads that one book, and no per-customer price exists
 * anywhere — `billing_subscriptions` can hold a negotiated plan LABEL but has no
 * amount column at all.
 *
 * `migrations/0033_price_configuration.sql:6-7` already calls pricing "a
 * PLATFORM-OWNER surface ... one catalogue serves the whole product". A sweep that
 * "finishes the job" by scoping these fails `0100`'s integrity assertion.
 */
export const PLATFORM_GLOBAL_TABLES = [
  "currencies",
  "fx_rates",
  "price_amounts",
  "price_groups",
  "price_plans",
  "pricing_draft_meta",
  "pricing_settings",
  "pricing_versions",
] as const;

/** One hop of an ownership path: this table's column points at that table's key. */
export interface OwnerHop {
  /** The column on the child that holds the reference. */
  readonly column: string;
  /** The parent table. */
  readonly parent: string;
  /** The parent's referenced column. Always a primary key in this schema. */
  readonly parentKey: string;
}

/**
 * **WHO OWNS A ROW THAT HAS NO TENANT COLUMN — ANSWERED ONCE.**
 *
 * The 33 tables of §5b's "scoped by proxy" bucket, minus the two promoted to
 * direct keys in 0086, each mapped to the path that reaches a tenant-keyed table.
 *
 * This map is a set of JUDGEMENTS and that is exactly why it is here. A table's
 * shortest foreign key is usually the WRONG scoping parent: `agreements` has a
 * one-hop edge to `users` through `countersigned_by`, and scoping an agreement by
 * who countersigned it is wrong twice over — the column is nullable, so unsigned
 * agreements vanish from a `JOIN`, and a countersignatory is not an owner. Every
 * path below leads with the **structural, NOT NULL** reference instead: an
 * agreement belongs to its sign-up, a score belongs to its deck, a cohort belongs
 * to its programme.
 *
 * Seven sessions reading one map make one judgement. Seven sessions each picking
 * a foreign key make thirty-three, and the nullable ones fail silently by
 * dropping rows rather than loudly by refusing them.
 *
 * `signatures` is the deepest at three hops — `signatures → agreements → signups
 * → decks` — which §5b names as the deepest in the schema.
 */
export const TENANT_OWNER: Readonly<Record<string, readonly OwnerHop[]>> = {
  // ── one hop to a tenant-keyed table ──────────────────────────────────────
  agreement_flow_steps: [{ column: "template_id", parent: "agreement_templates", parentKey: "id" }],
  agreement_template_fields: [{ column: "template_id", parent: "agreement_templates", parentKey: "id" }],
  agreement_template_programs: [{ column: "template_id", parent: "agreement_templates", parentKey: "id" }],
  crm_field_mappings: [{ column: "connection_id", parent: "crm_connections", parentKey: "id" }],
  cohorts: [{ column: "program_id", parent: "programs", parentKey: "id" }],
  parameter_rubric_bands: [{ column: "parameter_id", parent: "parameters", parentKey: "id" }],
  question_bank: [{ column: "parameter_id", parent: "parameters", parentKey: "id" }],
  call_outcomes: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  call_schedulers: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  calls: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  dd_items: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  deck_assignments: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  deck_extractions: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  deck_onboarding: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  deck_versions: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  evaluation_recommendations: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  evaluations: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  ic_votes: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  investment_dd: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  legal_dd: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  pipeline_events: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  portfolio: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  queries: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  // `scores` also references `parameters` and `evaluator_id`. The deck is the
  // owner: `deck_id` is NOT NULL, and a score belongs to the deck it scores, not
  // to the rubric row it uses or the person who entered it.
  scores: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  signups: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  term_sheets: [{ column: "deck_id", parent: "decks", parentKey: "id" }],
  vc_deals: [{ column: "deck_id", parent: "decks", parentKey: "id" }],

  // ── two hops ─────────────────────────────────────────────────────────────
  call_participants: [
    { column: "call_id", parent: "calls", parentKey: "id" },
    { column: "deck_id", parent: "decks", parentKey: "id" },
  ],
  agreements: [
    // NOT `countersigned_by` → `users`: nullable, and a countersignatory is not
    // an owner. `signup_id` is NOT NULL.
    { column: "signup_id", parent: "signups", parentKey: "id" },
    { column: "deck_id", parent: "decks", parentKey: "id" },
  ],
  signup_documents: [
    { column: "signup_id", parent: "signups", parentKey: "id" },
    { column: "deck_id", parent: "decks", parentKey: "id" },
  ],

  // ── three hops: the deepest path in the schema ────────────────────────────
  signatures: [
    { column: "agreement_id", parent: "agreements", parentKey: "id" },
    { column: "signup_id", parent: "signups", parentKey: "id" },
    { column: "deck_id", parent: "decks", parentKey: "id" },
  ],
};

/** Quote-free identifier guard. Aliases and columns are authored, never user input. */
function assertIdentifier(value: string, what: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`tenant scope: ${what} must be a bare SQL identifier, got ${JSON.stringify(value)}`);
  }
}

/**
 * The accumulator. Fragments and their binds are added together and read back
 * together, so the two cannot drift. Instances are mutable and single-use; build
 * one per statement.
 */
export class ScopeBuilder {
  private readonly parts: string[] = [];
  private readonly values: unknown[] = [];
  private readonly joins: string[] = [];
  private joinSeq = 0;

  constructor(private readonly scope: TenantScope) {}

  /**
   * Scope a table that carries `tenant_id` and `edition` itself — the 30 of
   * `TENANT_KEYED_TABLES`. `alias` is the alias used in the statement.
   */
  on(alias: string): this {
    assertIdentifier(alias, "alias");
    this.parts.push(`${alias}.tenant_id = ?`, `${alias}.edition = ?`);
    this.values.push(this.scope.tenantId, this.scope.edition);
    return this;
  }

  /**
   * Scope a table keyed by tenant ALONE — no `edition` column. Nothing in the
   * schema is in this position today (every one of the 30 keeps `edition`; see
   * §5c and `migrations/0094`, which measured that the deployed `account_profiles`
   * holds one row per edition and therefore cannot be keyed on the tenant alone).
   * It exists for `organizations` itself and for whatever the platform tier adds.
   */
  onTenantOnly(alias: string): this {
    assertIdentifier(alias, "alias");
    this.parts.push(`${alias}.tenant_id = ?`);
    this.values.push(this.scope.tenantId);
    return this;
  }

  /**
   * Scope a table that has no tenant column, by joining the owner `TENANT_OWNER`
   * names and scoping THAT. Returns the `JOIN` text to interpolate after the
   * `FROM` clause; the predicate goes into `whereClause()` with everything else,
   * which is what keeps bind order simple.
   *
   * The join is INNER on purpose. Every hop in `TENANT_OWNER` is a NOT NULL
   * reference, so an inner join drops no row that legitimately exists — and if one
   * day it drops rows, that is a broken ownership path being surfaced rather than a
   * leak being hidden. The two tables whose only references ARE nullable
   * (`email_outbox`, `esign_outbox`) are not in this map: they carry their own
   * column, for exactly this reason.
   */
  viaParent(table: string, alias: string): string {
    assertIdentifier(alias, "alias");
    const path = TENANT_OWNER[table];
    if (!path) {
      const advice = (TENANT_KEYED_TABLES as readonly string[]).includes(table)
        ? `"${table}" carries tenant_id directly — use .on("${alias}").`
        : `Add it to TENANT_OWNER in src/shared/tenant.ts, with the reason, rather than inventing a predicate at the call site.`;
      throw new Error(`tenant scope: no owner path for "${table}". ${advice}`);
    }
    const seq = this.joinSeq++;
    let childAlias = alias;
    let parentAlias = alias;
    for (const hop of path) {
      parentAlias = `owner${seq}_${hop.parent}`;
      this.joins.push(
        `JOIN ${hop.parent} ${parentAlias} ON ${parentAlias}.${hop.parentKey} = ${childAlias}.${hop.column}`,
      );
      childAlias = parentAlias;
    }
    this.on(parentAlias);
    return this.joins.slice(-path.length).join("\n");
  }

  /** Every join `viaParent` has emitted, in order. For callers that assemble the FROM clause themselves. */
  joinClause(): string {
    return this.joins.join("\n");
  }

  /** Add a predicate and its binds together. The whole point of the class. */
  and(sql: string, ...binds: unknown[]): this {
    this.parts.push(sql);
    this.values.push(...binds);
    return this;
  }

  /** Add a bind-free predicate. */
  andRaw(sql: string): this {
    this.parts.push(sql);
    return this;
  }

  /** The predicate text with no `WHERE` keyword, for callers composing their own. */
  get where(): string {
    return this.parts.join(" AND ");
  }

  /** `WHERE …`, or the empty string when nothing has been added. */
  whereClause(): string {
    return this.parts.length ? `WHERE ${this.where}` : "";
  }

  /** The binds, in the order the fragments were added. A fresh array each read. */
  get binds(): unknown[] {
    return [...this.values];
  }
}

/** Open a builder. One per statement. */
export function scoped(scope: TenantScope): ScopeBuilder {
  return new ScopeBuilder(scope);
}

/**
 * The INSERT side. Returns the column list, the matching placeholders and the
 * binds, so a write cannot name the columns without supplying the values.
 *
 * ```ts
 * const t = insertScope(scope);
 * await db.prepare(
 *   `INSERT INTO decks (id, ${t.columns}, name, status) VALUES (?, ${t.placeholders}, ?, ?)`,
 * ).bind(id, ...t.binds, name, status).run();
 * ```
 *
 * Pass `{ tenantOnly: true }` for a table with no `edition` column.
 */
export function insertScope(
  scope: TenantScope,
  { tenantOnly = false }: { tenantOnly?: boolean } = {},
): { columns: string; placeholders: string; binds: unknown[] } {
  return tenantOnly
    ? { columns: "tenant_id", placeholders: "?", binds: [scope.tenantId] }
    : { columns: "tenant_id, edition", placeholders: "?, ?", binds: [scope.tenantId, scope.edition] };
}

/**
 * True when two scopes are the same workspace. For the authorisation checks that
 * compare a loaded row against the caller — `users.ts`'s transfer-ownership is the
 * one §6 calls "the most dangerous route in the codebase" once tenancy exists,
 * because its two UPDATEs are `WHERE id = ? AND edition = ?` and would otherwise
 * promote a target in whichever customer's row matched.
 */
export function sameWorkspace(a: TenantScope, b: TenantScope): boolean {
  return a.tenantId === b.tenantId && a.edition === b.edition;
}

/** True when two scopes are the same customer, whichever workspace. */
export function sameTenant(a: Pick<TenantScope, "tenantId">, b: Pick<TenantScope, "tenantId">): boolean {
  return a.tenantId === b.tenantId;
}
