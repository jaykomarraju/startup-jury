/**
 * D1 access for the Agreements library, the Authorised signatories pool and the
 * per-record signing method. The router (`./routes.ts`) is HTTP, validation and
 * authZ; every statement lives here, so the shapes the two Admin console
 * sections read are defined in one place.
 *
 * Every table is W1-B's (`migrations/0034`, `0035`) except `esign_outbox` and
 * three columns, which are `migrations/0049`'s — the file header says exactly
 * which and why.
 *
 * ── TENANCY (T1-ESIGN) ──────────────────────────────────────────────────────
 *
 * Every function that took an `Edition` now takes a `TenantScope`, and every
 * statement here binds the workspace through `src/shared/tenant.ts`. Two shapes
 * appear:
 *
 *   · `agreement_templates`, `authorised_signatories`, `programs`, `users` and
 *     `esign_outbox` carry `tenant_id` themselves — `scoped(scope).on(alias)`.
 *   · `agreements` and `signatures` carry NO scope column. `plan_multitenancy.md`
 *     §5b counts `signatures` 1 `FROM` site / 0 `JOIN`s and names
 *     `signatures → agreements → signups → decks` the deepest ownership path in
 *     the schema. Those reach their owner through `viaParent`, and the UPDATEs —
 *     which cannot carry a JOIN in SQLite — through `ownedSignup()` below.
 *
 * A signed agreement is a legal record, so the writes are scoped too and not
 * merely the reads: `recordSignature` REFUSES an agreement outside the caller's
 * workspace rather than writing a signature nobody can account for.
 */

import type { Env } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { ROLES_BY_EDITION, roleLabel } from "../../shared/roles";
import { insertScope, scoped, type TenantScope } from "../../shared/tenant";
import {
  DEFAULT_SIGNING_METHOD,
  describeAssignment,
  describeSigningMethod,
  canEditSigningMethod,
  isPickable,
  signingMethodLockReason,
  templateSummary,
  type AgreementTemplateView,
  type ESignAttemptView,
  type ESignProvider,
  type FlowStep,
  type MergeField,
  type ProgrammeOptionView,
  type SignatoryAssignment,
  type SignatoryPool,
  type SignatureType,
  type SigningMethodView,
  type SignupStatus,
  type TemplateStage,
  type TemplateStatus,
} from "../../shared/agreements";

/**
 * The ownership predicate for a statement that cannot carry a `JOIN`.
 *
 * SQLite's `UPDATE` has no `FROM`, so the eight writes against `signups` and
 * `agreements` cannot use `ScopeBuilder.viaParent`. They correlate instead: the
 * row's sign-up must hang off a deck in the caller's workspace.
 *
 * `correlate` is the expression naming the `signups.id` to test — `signups.id`
 * for a write on the sign-up itself, `agreements.signup_id` for one on the
 * agreement. It is authored at every call site, never taken from a request.
 */
function ownedSignup(scope: TenantScope, correlate: string): { sql: string; binds: unknown[] } {
  const q = scoped(scope).on("own_d");
  return {
    sql:
      `EXISTS (SELECT 1 FROM signups own_s JOIN decks own_d ON own_d.id = own_s.deck_id ` +
      `WHERE own_s.id = ${correlate} AND ${q.where})`,
    binds: q.binds,
  };
}

// ── Templates ────────────────────────────────────────────────────────────────

interface TemplateRow {
  id: string;
  edition: string;
  code: string;
  name: string;
  file_name: string | null;
  file_url: string | null;
  version: string;
  status: string;
  stage: string;
  created_at: string;
  updated_at: string | null;
}

/**
 * The whole library for one workspace, each template with its fields, programme
 * map and flow. Four small queries rather than one join, because a join over
 * three one-to-many children would need de-duplicating in JS anyway and the
 * library is a handful of rows.
 */
export async function listTemplates(
  env: Env,
  scope: TenantScope,
): Promise<AgreementTemplateView[]> {
  const q = scoped(scope).on("t");
  const rows = (
    await env.DB.prepare(
      "SELECT t.id, t.edition, t.code, t.name, t.file_name, t.file_url, t.version, t.status, t.stage, " +
        `t.created_at, t.updated_at FROM agreement_templates t ${q.whereClause()} ORDER BY ` +
        // The prototype lists active first, then drafts, then retired at 60 %
        // opacity at the bottom (`suList` renders SU_TPL in that order).
        "CASE t.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, t.name",
    )
      .bind(...q.binds)
      .all<TemplateRow>()
  ).results;
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(", ");

  const fields = (
    await env.DB.prepare(
      `SELECT template_id, key, label, sample FROM agreement_template_fields WHERE template_id IN (${marks}) ORDER BY sort_order, key`,
    )
      .bind(...ids)
      .all<{ template_id: string; key: string; label: string; sample: string | null }>()
  ).results;

  // The programme a template is mapped to is scoped in its own right: a
  // cross-tenant `agreement_template_programs` row would otherwise put another
  // customer's fund name in this response through the join to `programs`.
  const pq = scoped(scope).on("p").and(`m.template_id IN (${marks})`, ...ids);
  const programs = (
    await env.DB.prepare(
      `SELECT m.template_id, m.program_id, p.name FROM agreement_template_programs m ` +
        `JOIN programs p ON p.id = m.program_id ${pq.whereClause()} ORDER BY p.sort_order, p.name`,
    )
      .bind(...pq.binds)
      .all<{ template_id: string; program_id: string; name: string }>()
  ).results;

  const steps = (
    await env.DB.prepare(
      `SELECT template_id, step_index, actor_role, action FROM agreement_flow_steps WHERE template_id IN (${marks}) ORDER BY step_index`,
    )
      .bind(...ids)
      .all<{ template_id: string; step_index: number; actor_role: string; action: string }>()
  ).results;

  // `agreementCount` is §11's dangerous shape — a `COUNT(*)` with no marker in
  // it — AND it is load-bearing: `DELETE /templates/:id` refuses a template this
  // number says is in use. `agreements` carries no scope column, so it is
  // counted through its owner (`agreements → signups → decks`). Unscoped, one
  // customer's agreement could pin another customer's draft permanently
  // undeletable, and nothing in the response would say why.
  const aq = scoped(scope);
  const aJoins = aq.viaParent("agreements", "a");
  aq.and(`a.template_id IN (${marks})`, ...ids);
  const used = (
    await env.DB.prepare(
      `SELECT a.template_id, COUNT(*) n FROM agreements a ${aJoins} ${aq.whereClause()} ` +
        "GROUP BY a.template_id",
    )
      .bind(...aq.binds)
      .all<{ template_id: string; n: number }>()
  ).results;

  return rows.map((r) => ({
    id: r.id,
    edition: r.edition as Edition,
    code: r.code,
    name: r.name,
    fileName: r.file_name,
    fileStored: r.file_url !== null,
    version: r.version,
    status: r.status as TemplateStatus,
    stage: r.stage as TemplateStage,
    fields: fields
      .filter((f) => f.template_id === r.id)
      .map((f) => ({ key: f.key, label: f.label, sample: f.sample })),
    programIds: programs.filter((p) => p.template_id === r.id).map((p) => p.program_id),
    programNames: programs.filter((p) => p.template_id === r.id).map((p) => p.name),
    flow: steps
      .filter((s) => s.template_id === r.id)
      .map((s) => ({ actor: s.actor_role, action: s.action }) as FlowStep),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    agreementCount: used.find((u) => u.template_id === r.id)?.n ?? 0,
  }));
}

export async function loadTemplate(
  env: Env,
  scope: TenantScope,
  id: string,
): Promise<AgreementTemplateView | null> {
  // Read through the list so one shape is built in one place; the library is
  // small enough that the extra rows cost nothing measurable. It is also what
  // makes every `loadTemplate` caller tenant-scoped for free — the router's
  // 404-on-missing becomes a 404 for another customer's template id.
  const all = await listTemplates(env, scope);
  return all.find((t) => t.id === id) ?? null;
}

/** The programme / fund toggles the "Applies to" card offers. */
export async function listProgrammes(
  env: Env,
  scope: TenantScope,
): Promise<ProgrammeOptionView[]> {
  const q = scoped(scope).on("p").andRaw("p.active = 1");
  return (
    await env.DB.prepare(
      `SELECT p.id, p.name FROM programs p ${q.whereClause()} ORDER BY p.sort_order, p.name`,
    )
      .bind(...q.binds)
      .all<ProgrammeOptionView>()
  ).results;
}

export interface NewTemplate {
  name: string;
  code: string;
  stage: TemplateStage;
  fields: MergeField[];
  flow: FlowStep[];
}

/**
 * `suAdd()` — a template exists the moment the admin asks for one, as a Draft
 * with the prototype's default single field and three-step flow, so the editor
 * has something to open on.
 */
export async function createTemplate(
  env: Env,
  scope: TenantScope,
  t: NewTemplate,
): Promise<string> {
  const id = `at_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  // `insertScope` rather than two hand-written binds: `agreement_templates` is
  // one of the eleven tables `0096` REBUILT, so its `tenant_id` is NOT NULL with
  // no default and a forgotten bind is a loud error rather than a row quietly
  // filed under the first customer. Keeping the write-side helper here anyway is
  // what makes the other, defaulted tables in this file safe by the same habit.
  const t0 = insertScope(scope);
  await env.DB.prepare(
    `INSERT INTO agreement_templates (id, ${t0.columns}, code, name, file_name, file_url, version, status, stage, created_at, updated_at) ` +
      `VALUES (?, ${t0.placeholders}, ?, ?, NULL, NULL, 'v1', 'draft', ?, ?, ?)`,
  )
    .bind(id, ...t0.binds, t.code, t.name, t.stage, now, now)
    .run();
  await replaceFields(env, id, t.fields);
  await replaceFlow(env, id, t.flow);
  return id;
}

export interface TemplatePatch {
  name?: string;
  version?: string;
  status?: TemplateStatus;
  stage?: TemplateStage;
  fields?: MergeField[];
  programIds?: string[];
  flow?: FlowStep[];
}

export async function updateTemplate(
  env: Env,
  scope: TenantScope,
  id: string,
  patch: TemplatePatch,
): Promise<void> {
  // The ownership check is SEPARATE from the UPDATE and comes first, because the
  // three child writes below are keyed on `template_id` alone and cannot be
  // scoped themselves. Without this, an `UPDATE … WHERE tenant_id = ?` that
  // matched nothing would still fall through and `replaceFields` would DELETE
  // another customer's merge fields — a scoped statement followed by three
  // unscoped ones, which is exactly the shape §5b calls safe-because-the-check-
  // happened-above-them and therefore the shape that breaks together.
  const owns = await ownsTemplate(env, scope, id);
  if (!owns) return;

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    binds.push(patch.name);
  }
  if (patch.version !== undefined) {
    sets.push("version = ?");
    binds.push(patch.version);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    binds.push(patch.status);
  }
  if (patch.stage !== undefined) {
    sets.push("stage = ?");
    binds.push(patch.stage);
  }
  sets.push("updated_at = ?");
  binds.push(new Date().toISOString());
  const q = scoped(scope).on("agreement_templates").and("id = ?", id);
  await env.DB.prepare(
    `UPDATE agreement_templates SET ${sets.join(", ")} ${q.whereClause()}`,
  )
    .bind(...binds, ...q.binds)
    .run();

  if (patch.fields) await replaceFields(env, id, patch.fields);
  if (patch.flow) await replaceFlow(env, id, patch.flow);
  if (patch.programIds) await replaceProgrammes(env, scope, id, patch.programIds);
}

/** Is this template id the caller's workspace's? The guard every child write needs. */
async function ownsTemplate(env: Env, scope: TenantScope, id: string): Promise<boolean> {
  const q = scoped(scope).on("t").and("t.id = ?", id);
  const row = await env.DB.prepare(`SELECT 1 n FROM agreement_templates t ${q.whereClause()}`)
    .bind(...q.binds)
    .first<{ n: number }>();
  return row !== null;
}

/**
 * Children are replaced wholesale rather than diffed. The editor posts the full
 * set (the prototype's cards are one array each), and a delete-then-insert in
 * one `batch` is atomic in D1 — a diff would be more code for the same result
 * and could leave a half-applied field list if it failed partway.
 */
async function replaceFields(env: Env, templateId: string, fields: MergeField[]): Promise<void> {
  const stmts = [
    env.DB.prepare("DELETE FROM agreement_template_fields WHERE template_id = ?").bind(templateId),
    ...fields.map((f, i) =>
      env.DB.prepare(
        "INSERT INTO agreement_template_fields (id, template_id, key, label, sample, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(`atf_${crypto.randomUUID()}`, templateId, f.key, f.label, f.sample, i + 1),
    ),
  ];
  await env.DB.batch(stmts);
}

async function replaceFlow(env: Env, templateId: string, flow: FlowStep[]): Promise<void> {
  const stmts = [
    env.DB.prepare("DELETE FROM agreement_flow_steps WHERE template_id = ?").bind(templateId),
    ...flow.map((s, i) =>
      env.DB.prepare(
        "INSERT INTO agreement_flow_steps (id, template_id, step_index, actor_role, action) VALUES (?, ?, ?, ?, ?)",
      ).bind(`afs_${crypto.randomUUID()}`, templateId, i + 1, s.actor, s.action),
    ),
  ];
  await env.DB.batch(stmts);
}

/**
 * Programme ids are filtered against the caller's WORKSPACE before they are
 * written, so a request cannot map an incubator template onto a VC fund by id —
 * nor onto another customer's fund, which is the same defect one dimension out.
 */
async function replaceProgrammes(
  env: Env,
  scope: TenantScope,
  templateId: string,
  programIds: string[],
): Promise<void> {
  const valid = new Set((await listProgrammes(env, scope)).map((p) => p.id));
  const keep = programIds.filter((id) => valid.has(id));
  const stmts = [
    env.DB.prepare("DELETE FROM agreement_template_programs WHERE template_id = ?").bind(templateId),
    ...keep.map((programId) =>
      env.DB.prepare(
        "INSERT INTO agreement_template_programs (template_id, program_id) VALUES (?, ?)",
      ).bind(templateId, programId),
    ),
  ];
  await env.DB.batch(stmts);
}

/** Record an uploaded source file against the template. */
export async function setTemplateFile(
  env: Env,
  scope: TenantScope,
  id: string,
  file: { name: string; key: string },
): Promise<void> {
  const q = scoped(scope).on("agreement_templates").and("id = ?", id);
  await env.DB.prepare(
    `UPDATE agreement_templates SET file_name = ?, file_url = ?, updated_at = ? ${q.whereClause()}`,
  )
    .bind(file.name, file.key, new Date().toISOString(), ...q.binds)
    .run();
}

export async function deleteTemplate(env: Env, scope: TenantScope, id: string): Promise<void> {
  // The three child tables all cascade on `template_id` (`migrations/0035`), so
  // scoping the parent scopes the cascade with it.
  const q = scoped(scope).on("agreement_templates").and("id = ?", id);
  await env.DB.prepare(`DELETE FROM agreement_templates ${q.whereClause()}`)
    .bind(...q.binds)
    .run();
}

/** The list row's summary line, computed server-side so the API can be asserted. */
export function summaryOf(t: AgreementTemplateView): string {
  return templateSummary(t);
}

// ── Authorised signatories ───────────────────────────────────────────────────

/**
 * The pool `s-susign.html` administers: one row per role of the edition, and
 * one per staff member who has ever been granted (or considered).
 *
 * Roles come from `ROLES_BY_EDITION` rather than from the table, so a role with
 * no row yet renders OFF instead of vanishing — which is what makes the
 * section's toggle list stable as roles are added. `founder` is excluded: a
 * founder countersigning on the organisation's behalf is a contradiction, and
 * the prototype's role list stops at the internal roles.
 */
export async function loadSignatoryPool(env: Env, scope: TenantScope): Promise<SignatoryPool> {
  const gq = scoped(scope).on("a");
  const grants = (
    await env.DB.prepare(
      `SELECT a.role, a.user_id, a.enabled FROM authorised_signatories a ${gq.whereClause()}`,
    )
      .bind(...gq.binds)
      .all<{ role: string | null; user_id: string | null; enabled: number }>()
  ).results;

  const roles = ROLES_BY_EDITION[scope.edition]
    .filter((r) => r !== "founder")
    .map((role) => ({
      role,
      label: roleLabel(scope.edition, role),
      enabled: grants.some((g) => g.role === role && g.enabled === 1),
    }));

  // Named individuals: everyone with a user grant row, plus every active staff
  // member, so "Add individual" has a list to add from. Deleted users
  // (`0044.deleted_at`) and founders are out.
  const uq = scoped(scope)
    .on("u")
    .andRaw("u.role <> 'founder' AND u.role <> 'mentor' AND u.active = 1 AND u.deleted_at IS NULL");
  const users = (
    await env.DB.prepare(
      `SELECT u.id, u.name, u.role FROM users u ${uq.whereClause()} ORDER BY u.name`,
    )
      .bind(...uq.binds)
      .all<{ id: string; name: string; role: string }>()
  ).results;

  return {
    roles,
    users: users.map((u) => ({
      userId: u.id,
      name: u.name,
      role: u.role as Role,
      roleLabel: roleLabel(scope.edition, u.role as Role),
      enabled: grants.some((g) => g.user_id === u.id && g.enabled === 1),
    })),
  };
}

/**
 * **TWO OF THE NINE `ON CONFLICT` SITES THE TENANCY WAVE HAD TO WIDEN.**
 *
 * `0099_tenant_index_pass.sql` did NOT drop `authorised_signatories`' two
 * original partial uniques; it ADDED the tenant-scoped pair beside them, under
 * new names, precisely so these two upserts kept resolving while T0 merged. The
 * widening here is the other half of that transaction, and integration drops the
 * legacy pair from the declared headroom (`0101`–`0108`) once it has landed.
 *
 * **The `WHERE` clause is part of the key, not decoration.** A partial index can
 * only be an `ON CONFLICT` target when the statement repeats its predicate
 * verbatim, so `WHERE role IS NOT NULL` and `WHERE user_id IS NOT NULL` survive
 * the widening unchanged — they are what make the two constraints
 * non-overlapping on a table whose own `CHECK` says exactly one of the columns
 * is set.
 *
 * Measured against the materialised chain (2026-09-30), with BOTH index pairs
 * standing as they do today:
 *
 *   · same tenant, widened target → upserts correctly, updating the existing row
 *     and keeping its original id;
 *   · a SECOND tenant → `UNIQUE constraint failed: authorised_signatories.edition,
 *     authorised_signatories.role`. That is the legacy index refusing, loudly and
 *     by name. It is the correct error for "integration has not run yet", not a
 *     defect in this code: dropping the two legacy indexes makes the same insert
 *     succeed, verified.
 *
 * The id gains the tenant for the same reason the index did — it is the PRIMARY
 * KEY, and two customers granting the same role would otherwise collide on it.
 * Rows seeded before tenancy keep their shorter ids; the upsert resolves on the
 * index, not on the id, so nothing needs rewriting.
 */
export async function setRoleGrant(
  env: Env,
  scope: TenantScope,
  role: Role,
  enabled: boolean,
): Promise<void> {
  const t = insertScope(scope);
  await env.DB.prepare(
    `INSERT INTO authorised_signatories (id, ${t.columns}, role, user_id, enabled) VALUES (?, ${t.placeholders}, ?, NULL, ?) ` +
      "ON CONFLICT (tenant_id, edition, role) WHERE role IS NOT NULL DO UPDATE SET enabled = excluded.enabled",
  )
    .bind(`as_${scope.tenantId}_${scope.edition}_role_${role}`, ...t.binds, role, enabled ? 1 : 0)
    .run();
}

export async function setUserGrant(
  env: Env,
  scope: TenantScope,
  userId: string,
  enabled: boolean,
): Promise<void> {
  const t = insertScope(scope);
  await env.DB.prepare(
    `INSERT INTO authorised_signatories (id, ${t.columns}, role, user_id, enabled) VALUES (?, ${t.placeholders}, NULL, ?, ?) ` +
      "ON CONFLICT (tenant_id, edition, user_id) WHERE user_id IS NOT NULL DO UPDATE SET enabled = excluded.enabled",
  )
    .bind(`as_${scope.tenantId}_${scope.edition}_user_${userId}`, ...t.binds, userId, enabled ? 1 : 0)
    .run();
}

// ── The signing method, per sign-up record ───────────────────────────────────

interface SignupRow {
  id: string;
  deck_id: string;
  deck_name: string;
  edition: string;
  program_id: string | null;
  uploaded_by: string | null;
  founder_email: string | null;
  status: string;
  signing_provider: string | null;
  sig_type: string | null;
  in_app: number;
  wet_ink: number;
  authorised_signatory_user_id: string | null;
  authorised_signatory_role: string | null;
  founder_signed_at: string | null;
}

export interface SignupRecord {
  row: SignupRow;
  edition: Edition;
  assignment: SignatoryAssignment;
  status: SignupStatus;
}

/**
 * The sign-up record, and the only place the router learns a sign-up exists.
 *
 * `signups` has no scope column of its own; it is reached through its deck, and
 * this statement already carried the join, so the whole widening is one `.on("d")`
 * — which is also why scoping HERE scopes the eight routes above it. A record in
 * another customer's workspace comes back `null` and the router answers 404,
 * the same shape it already used for another edition.
 */
export async function loadSignup(
  env: Env,
  scope: TenantScope,
  signupId: string,
): Promise<SignupRecord | null> {
  const q = scoped(scope).on("d").and("s.id = ?", signupId);
  const row = await env.DB.prepare(
    "SELECT s.id, s.deck_id, d.name deck_name, d.edition, d.program_id, d.uploaded_by, d.founder_email, s.status, " +
      "s.signing_provider, s.sig_type, s.in_app, s.wet_ink, s.authorised_signatory_user_id, " +
      "s.authorised_signatory_role, s.founder_signed_at " +
      `FROM signups s JOIN decks d ON d.id = s.deck_id ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .first<SignupRow>();
  if (!row) return null;
  return {
    row,
    edition: row.edition as Edition,
    status: row.status as SignupStatus,
    assignment: {
      role: (row.authorised_signatory_role as Role | null) ?? null,
      userId: row.authorised_signatory_user_id,
    },
  };
}

/**
 * The wire shape of one record's signing method, including whether it may still
 * be changed and — when it may not — the sentence saying why.
 *
 * `configured: false` means no provider has been chosen yet; the view still
 * carries the platform defaults so the card renders with them pre-selected,
 * exactly as `suMethodCard` does by assigning `d.method` on first render.
 */
export function signingMethodView(
  record: SignupRecord,
  pool: SignatoryPool,
): SigningMethodView {
  const { row } = record;
  const configured = row.signing_provider !== null;
  const method = {
    provider: (row.signing_provider as ESignProvider | null) ?? DEFAULT_SIGNING_METHOD.provider,
    sigType: (row.sig_type as SignatureType | null) ?? DEFAULT_SIGNING_METHOD.sigType,
    inApp: configured ? row.in_app === 1 : DEFAULT_SIGNING_METHOD.inApp,
    wetInk: configured ? row.wet_ink === 1 : DEFAULT_SIGNING_METHOD.wetInk,
  };
  const gate = { status: record.status, founderSignedAt: row.founder_signed_at };
  return {
    ...method,
    signupId: row.id,
    deckId: row.deck_id,
    deckName: row.deck_name,
    status: record.status,
    founderSignedAt: row.founder_signed_at,
    configured,
    editable: canEditSigningMethod(gate),
    lockReason: signingMethodLockReason(gate),
    assignment: record.assignment,
    assignmentLabel: describeAssignment(pool, record.assignment),
  };
}

/** The locked card's one-liner, for callers that only want the sentence. */
export function methodLine(view: SigningMethodView): string {
  return describeSigningMethod(view);
}

export async function saveSigningMethod(
  env: Env,
  scope: TenantScope,
  signupId: string,
  method: { provider: ESignProvider; sigType: SignatureType; inApp: boolean; wetInk: boolean },
): Promise<void> {
  const own = ownedSignup(scope, "signups.id");
  await env.DB.prepare(
    "UPDATE signups SET signing_provider = ?, sig_type = ?, in_app = ?, wet_ink = ? " +
      `WHERE id = ? AND ${own.sql}`,
  )
    .bind(
      method.provider,
      method.sigType,
      method.inApp ? 1 : 0,
      method.wetInk ? 1 : 0,
      signupId,
      ...own.binds,
    )
    .run();
}

/**
 * Assign the countersignatory. Exactly one of the two columns is ever set, so
 * re-assigning by role clears a previous named individual and vice versa —
 * otherwise a record could carry two contradictory assignments and
 * `countersignRefusal` would silently prefer the person.
 */
export async function saveAssignment(
  env: Env,
  scope: TenantScope,
  signupId: string,
  assignment: SignatoryAssignment,
): Promise<void> {
  const own = ownedSignup(scope, "signups.id");
  await env.DB.prepare(
    "UPDATE signups SET authorised_signatory_role = ?, authorised_signatory_user_id = ? " +
      `WHERE id = ? AND ${own.sql}`,
  )
    .bind(assignment.role, assignment.userId, signupId, ...own.binds)
    .run();
}

/** Record the founder's signature — the act that locks the method. */
export async function markFounderSigned(
  env: Env,
  scope: TenantScope,
  signupId: string,
  at: string,
): Promise<void> {
  const ownSignup = ownedSignup(scope, "signups.id");
  const ownAgreement = ownedSignup(scope, "agreements.signup_id");
  await env.DB.batch([
    // `progress` is 0034's "founder has acted" state; a record already further
    // along keeps the status it has.
    env.DB.prepare(
      "UPDATE signups SET founder_signed_at = ?, status = CASE WHEN status = 'initiated' THEN 'progress' ELSE status END " +
        `WHERE id = ? AND ${ownSignup.sql}`,
    ).bind(at, signupId, ...ownSignup.binds),
    // Every agreement on this sign-up freezes with it.
    env.DB.prepare(
      `UPDATE agreements SET method_locked = 1 WHERE signup_id = ? AND ${ownAgreement.sql}`,
    ).bind(signupId, ...ownAgreement.binds),
  ]);
}

export async function markCountersigned(
  env: Env,
  scope: TenantScope,
  signupId: string,
  userId: string,
  at: string,
): Promise<void> {
  const ownAgreement = ownedSignup(scope, "agreements.signup_id");
  const ownSignup = ownedSignup(scope, "signups.id");
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE agreements SET countersigned_by = ?, countersigned_at = ? " +
        `WHERE signup_id = ? AND countersigned_at IS NULL AND ${ownAgreement.sql}`,
    ).bind(userId, at, signupId, ...ownAgreement.binds),
    env.DB.prepare(
      "UPDATE signups SET status = 'completed', completed_at = ? " +
        `WHERE id = ? AND status IN ('initiated', 'progress') AND ${ownSignup.sql}`,
    ).bind(at, signupId, ...ownSignup.binds),
  ]);
}

export async function countAgreements(
  env: Env,
  scope: TenantScope,
  signupId: string,
): Promise<number> {
  const q = scoped(scope);
  const joins = q.viaParent("agreements", "a");
  q.and("a.signup_id = ?", signupId);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) n FROM agreements a ${joins} ${q.whereClause()}`,
  )
    .bind(...q.binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ── The agreement instance ───────────────────────────────────────────────────

export interface AgreementRow {
  id: string;
  signup_id: string;
  template_id: string | null;
  kind: string;
  template_url: string | null;
  merge_values_json: string | null;
  status: string;
  method_locked: number;
  countersigned_by: string | null;
  countersigned_at: string | null;
}

export async function loadAgreement(
  env: Env,
  scope: TenantScope,
  signupId: string,
): Promise<AgreementRow | null> {
  const q = scoped(scope);
  const joins = q.viaParent("agreements", "a");
  q.and("a.signup_id = ?", signupId);
  return env.DB.prepare(
    "SELECT a.id, a.signup_id, a.template_id, a.kind, a.template_url, a.merge_values_json, a.status, " +
      `a.method_locked, a.countersigned_by, a.countersigned_at FROM agreements a ${joins} ` +
      `${q.whereClause()} ORDER BY a.created_at LIMIT 1`,
  )
    .bind(...q.binds)
    .first<AgreementRow>();
}

/**
 * **Which template applies to this record** (F0046: "Which template applies to
 * which program/fund at which stage").
 *
 * Only a pickable (Active) template at the record's stage is a candidate — a
 * Retired one "stays for audit but can't be picked for new sign-ups". Among
 * those, a template mapped to the deck's own programme wins; failing that an
 * unmapped template, which is the library's edition-wide default; failing that
 * nothing, and the caller reports it rather than guessing.
 */
export function applicableTemplate(
  templates: readonly AgreementTemplateView[],
  opts: { programId: string | null; stage: TemplateStage },
): AgreementTemplateView | null {
  const candidates = templates.filter((t) => isPickable(t) && t.stage === opts.stage);
  if (opts.programId) {
    const mapped = candidates.find((t) => t.programIds.includes(opts.programId!));
    if (mapped) return mapped;
  }
  return candidates.find((t) => t.programIds.length === 0) ?? null;
}

/**
 * Raise the agreement instance for a sign-up, or return the one already raised.
 *
 * `agreements.kind` and `template_url` are denormalised from the template on
 * purpose (`migrations/0035`'s own comment): a retired template must still read
 * correctly in the audit, and a new version of the file must not retroactively
 * change what somebody signed.
 */
export async function prepareAgreement(
  env: Env,
  scope: TenantScope,
  record: SignupRecord,
  template: AgreementTemplateView,
  mergeValues: Record<string, string>,
): Promise<AgreementRow> {
  const existing = await loadAgreement(env, scope, record.row.id);
  if (existing) {
    // Merge values stay editable until the founder signs — that is what "Fill
    // blanks" is, and the lock is the same one the method has. The id came from
    // the scoped read directly above, so the UPDATE's `WHERE id = ?` is already
    // a workspace row; the ownership predicate is repeated anyway because the
    // whole point of §5b's proxy bucket is that the two statements break
    // together the day somebody moves one of them.
    if (existing.method_locked === 0) {
      const own = ownedSignup(scope, "agreements.signup_id");
      await env.DB.prepare(
        `UPDATE agreements SET merge_values_json = ? WHERE id = ? AND ${own.sql}`,
      )
        .bind(JSON.stringify(mergeValues), existing.id, ...own.binds)
        .run();
      return (await loadAgreement(env, scope, record.row.id))!;
    }
    return existing;
  }
  // `agreements` carries no tenant column — it is scoped through
  // `signup_id → signups → decks`. Neither value here comes off a request:
  // `record` was loaded by the scoped `loadSignup` and `template` was chosen out
  // of a scoped `listTemplates`, so the row lands in the caller's workspace by
  // construction and there is no column to bind.
  const id = `agr_${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO agreements (id, signup_id, template_id, kind, template_url, merge_values_json, status, method_locked) " +
      "VALUES (?, ?, ?, ?, ?, ?, 'active', ?)",
  )
    .bind(
      id,
      record.row.id,
      template.id,
      template.code,
      template.fileName,
      JSON.stringify(mergeValues),
      record.row.founder_signed_at === null ? 0 : 1,
    )
    .run();
  return (await loadAgreement(env, scope, record.row.id))!;
}

/**
 * Record one signature against an agreement.
 *
 * **This is the write the wave's priority sentence is about.** A signature is a
 * legal record and `signatures` carries no scope column at all — §5b counts it 1
 * `FROM` site and 0 `JOIN`s, the purest instance of the defect. So this refuses
 * rather than writes: if the agreement named is not reachable from the caller's
 * workspace through `signatures → agreements → signups → decks`, nothing is
 * inserted and the call throws.
 *
 * Throwing is deliberate and is the opposite of what the read side does. A read
 * that finds nothing is an ordinary 404 — the row may simply not exist. A
 * signature addressed at another customer's agreement is not an ordinary
 * outcome, and the two live callers both resolved the agreement through
 * `loadAgreement` one frame up, so this can only fire if that frame is ever
 * removed. A silent no-op there would leave a countersigned agreement with no
 * signature row and no complaint.
 */
export async function recordSignature(
  env: Env,
  scope: TenantScope,
  args: {
    agreementId: string;
    signerUserId: string | null;
    signerEmail: string | null;
    signerName: string | null;
    provider: ESignProvider;
    sigType: SignatureType;
    providerReference: string | null;
    at: string;
  },
): Promise<void> {
  const own = scoped(scope);
  const ownJoins = own.viaParent("agreements", "a");
  own.and("a.id = ?", args.agreementId);
  const owned = await env.DB.prepare(
    `SELECT 1 n FROM agreements a ${ownJoins} ${own.whereClause()}`,
  )
    .bind(...own.binds)
    .first<{ n: number }>();
  if (!owned) {
    throw new Error(
      `tenant scope: refusing to sign agreement ${args.agreementId}, which is not in this workspace`,
    );
  }

  await env.DB.prepare(
    "INSERT INTO signatures (id, agreement_id, signer_user_id, signer_email, signer_name, " +
      "method_provider, sig_type, provider_reference, signed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      `sig_${crypto.randomUUID()}`,
      args.agreementId,
      args.signerUserId,
      args.signerEmail,
      args.signerName,
      args.provider,
      args.sigType,
      args.providerReference,
      args.at,
    )
    .run();
}

/**
 * The signatures on one agreement — signer names and email addresses, which is
 * why it is scoped through all three hops rather than trusted to the id.
 */
export async function listSignatures(
  env: Env,
  scope: TenantScope,
  agreementId: string,
): Promise<Array<{ signerName: string | null; signerEmail: string | null; signedAt: string | null }>> {
  const q = scoped(scope);
  const joins = q.viaParent("signatures", "sg");
  q.and("sg.agreement_id = ?", agreementId);
  return (
    await env.DB.prepare(
      "SELECT sg.signer_name signerName, sg.signer_email signerEmail, sg.signed_at signedAt " +
        `FROM signatures sg ${joins} ${q.whereClause()} ORDER BY sg.created_at`,
    )
      .bind(...q.binds)
      .all<{ signerName: string | null; signerEmail: string | null; signedAt: string | null }>()
  ).results;
}

// ── The stub's audit trail ───────────────────────────────────────────────────

/**
 * **`esign_outbox` is the plan correction this session owns.**
 *
 * §5b classified it "scoped by proxy", but both of its foreign keys are NULLABLE
 * by design — `0049`'s own comment: "an attempt may precede the `agreements` row
 * (a method preview) and a voided envelope may outlive its sign-up". A join
 * through a nullable reference drops exactly the rows that have no parent, which
 * is to say the rows a proxy scope was supposed to cover. There is no parent to
 * scope it through, so `0086` gave it a DIRECT tenant key instead and
 * `TENANT_KEYED_TABLES` lists it.
 *
 * It has no `edition` column, so `onTenantOnly` is correct here and `.on()` would
 * not compile a valid statement.
 */
export async function listAttempts(
  env: Env,
  scope: TenantScope,
  signupId: string,
  limit = 20,
): Promise<ESignAttemptView[]> {
  const q = scoped(scope).onTenantOnly("x").and("x.signup_id = ?", signupId);
  const rows = (
    await env.DB.prepare(
      "SELECT x.id, x.signup_id, x.agreement_id, x.kind, x.provider, x.sig_type, x.recipients_json, " +
        "x.document_name, x.status, x.provider_reference, x.error, x.created_at " +
        `FROM esign_outbox x ${q.whereClause()} ORDER BY x.created_at DESC, x.id DESC LIMIT ?`,
    )
      .bind(...q.binds, limit)
      .all<{
        id: string;
        signup_id: string | null;
        agreement_id: string | null;
        kind: string;
        provider: string;
        sig_type: string;
        recipients_json: string;
        document_name: string | null;
        status: string;
        provider_reference: string | null;
        error: string | null;
        created_at: string;
      }>()
  ).results;
  return rows.map((r) => ({
    id: r.id,
    signupId: r.signup_id,
    agreementId: r.agreement_id,
    kind: r.kind,
    provider: r.provider as ESignProvider,
    sigType: r.sig_type as SignatureType,
    status: r.status as ESignAttemptView["status"],
    recipients: safeJsonArray(r.recipients_json),
    documentName: r.document_name,
    providerReference: r.provider_reference,
    error: r.error,
    createdAt: r.created_at,
  }));
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
