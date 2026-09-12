/**
 * D1 access for the Agreements library, the Authorised signatories pool and the
 * per-record signing method. The router (`./routes.ts`) is HTTP, validation and
 * authZ; every statement lives here, so the shapes the two Admin console
 * sections read are defined in one place.
 *
 * Every table is W1-B's (`migrations/0034`, `0035`) except `esign_outbox` and
 * three columns, which are `migrations/0049`'s — the file header says exactly
 * which and why.
 */

import type { Env } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { ROLES_BY_EDITION, roleLabel } from "../../shared/roles";
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
 * The whole library for one edition, each template with its fields, programme
 * map and flow. Four small queries rather than one join, because a join over
 * three one-to-many children would need de-duplicating in JS anyway and the
 * library is a handful of rows.
 */
export async function listTemplates(
  env: Env,
  edition: Edition,
): Promise<AgreementTemplateView[]> {
  const rows = (
    await env.DB.prepare(
      "SELECT id, edition, code, name, file_name, file_url, version, status, stage, created_at, updated_at " +
        "FROM agreement_templates WHERE edition = ? ORDER BY " +
        // The prototype lists active first, then drafts, then retired at 60 %
        // opacity at the bottom (`suList` renders SU_TPL in that order).
        "CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, name",
    )
      .bind(edition)
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

  const programs = (
    await env.DB.prepare(
      `SELECT m.template_id, m.program_id, p.name FROM agreement_template_programs m ` +
        `JOIN programs p ON p.id = m.program_id WHERE m.template_id IN (${marks}) ORDER BY p.sort_order, p.name`,
    )
      .bind(...ids)
      .all<{ template_id: string; program_id: string; name: string }>()
  ).results;

  const steps = (
    await env.DB.prepare(
      `SELECT template_id, step_index, actor_role, action FROM agreement_flow_steps WHERE template_id IN (${marks}) ORDER BY step_index`,
    )
      .bind(...ids)
      .all<{ template_id: string; step_index: number; actor_role: string; action: string }>()
  ).results;

  const used = (
    await env.DB.prepare(
      `SELECT template_id, COUNT(*) n FROM agreements WHERE template_id IN (${marks}) GROUP BY template_id`,
    )
      .bind(...ids)
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
  edition: Edition,
  id: string,
): Promise<AgreementTemplateView | null> {
  // Read through the list so one shape is built in one place; the library is
  // small enough that the extra rows cost nothing measurable.
  const all = await listTemplates(env, edition);
  return all.find((t) => t.id === id) ?? null;
}

/** The programme / fund toggles the "Applies to" card offers. */
export async function listProgrammes(
  env: Env,
  edition: Edition,
): Promise<ProgrammeOptionView[]> {
  return (
    await env.DB.prepare(
      "SELECT id, name FROM programs WHERE edition = ? AND active = 1 ORDER BY sort_order, name",
    )
      .bind(edition)
      .all<ProgrammeOptionView>()
  ).results;
}

export interface NewTemplate {
  edition: Edition;
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
export async function createTemplate(env: Env, t: NewTemplate): Promise<string> {
  const id = `at_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO agreement_templates (id, edition, code, name, file_name, file_url, version, status, stage, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, NULL, NULL, 'v1', 'draft', ?, ?, ?)",
  )
    .bind(id, t.edition, t.code, t.name, t.stage, now, now)
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
  edition: Edition,
  id: string,
  patch: TemplatePatch,
): Promise<void> {
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
  await env.DB.prepare(
    `UPDATE agreement_templates SET ${sets.join(", ")} WHERE id = ? AND edition = ?`,
  )
    .bind(...binds, id, edition)
    .run();

  if (patch.fields) await replaceFields(env, id, patch.fields);
  if (patch.flow) await replaceFlow(env, id, patch.flow);
  if (patch.programIds) await replaceProgrammes(env, edition, id, patch.programIds);
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
 * Programme ids are filtered against the caller's edition before they are
 * written, so a request cannot map an incubator template onto a VC fund by id.
 */
async function replaceProgrammes(
  env: Env,
  edition: Edition,
  templateId: string,
  programIds: string[],
): Promise<void> {
  const valid = new Set((await listProgrammes(env, edition)).map((p) => p.id));
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
  edition: Edition,
  id: string,
  file: { name: string; key: string },
): Promise<void> {
  await env.DB.prepare(
    "UPDATE agreement_templates SET file_name = ?, file_url = ?, updated_at = ? WHERE id = ? AND edition = ?",
  )
    .bind(file.name, file.key, new Date().toISOString(), id, edition)
    .run();
}

export async function deleteTemplate(env: Env, edition: Edition, id: string): Promise<void> {
  // The three child tables all cascade on `template_id` (`migrations/0035`).
  await env.DB.prepare("DELETE FROM agreement_templates WHERE id = ? AND edition = ?")
    .bind(id, edition)
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
export async function loadSignatoryPool(env: Env, edition: Edition): Promise<SignatoryPool> {
  const grants = (
    await env.DB.prepare(
      "SELECT role, user_id, enabled FROM authorised_signatories WHERE edition = ?",
    )
      .bind(edition)
      .all<{ role: string | null; user_id: string | null; enabled: number }>()
  ).results;

  const roles = ROLES_BY_EDITION[edition]
    .filter((r) => r !== "founder")
    .map((role) => ({
      role,
      label: roleLabel(edition, role),
      enabled: grants.some((g) => g.role === role && g.enabled === 1),
    }));

  // Named individuals: everyone with a user grant row, plus every active staff
  // member, so "Add individual" has a list to add from. Deleted users
  // (`0044.deleted_at`) and founders are out.
  const users = (
    await env.DB.prepare(
      "SELECT id, name, role FROM users WHERE edition = ? AND role <> 'founder' AND role <> 'mentor' " +
        "AND active = 1 AND deleted_at IS NULL ORDER BY name",
    )
      .bind(edition)
      .all<{ id: string; name: string; role: string }>()
  ).results;

  return {
    roles,
    users: users.map((u) => ({
      userId: u.id,
      name: u.name,
      role: u.role as Role,
      roleLabel: roleLabel(edition, u.role as Role),
      enabled: grants.some((g) => g.user_id === u.id && g.enabled === 1),
    })),
  };
}

/** Toggle one grant. Rows are created on demand so the seed need not be total. */
export async function setRoleGrant(
  env: Env,
  edition: Edition,
  role: Role,
  enabled: boolean,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO authorised_signatories (id, edition, role, user_id, enabled) VALUES (?, ?, ?, NULL, ?) " +
      // The UNIQUE partial index on (edition, role) is what makes the upsert work.
      "ON CONFLICT (edition, role) WHERE role IS NOT NULL DO UPDATE SET enabled = excluded.enabled",
  )
    .bind(`as_${edition}_role_${role}`, edition, role, enabled ? 1 : 0)
    .run();
}

export async function setUserGrant(
  env: Env,
  edition: Edition,
  userId: string,
  enabled: boolean,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO authorised_signatories (id, edition, role, user_id, enabled) VALUES (?, ?, NULL, ?, ?) " +
      "ON CONFLICT (edition, user_id) WHERE user_id IS NOT NULL DO UPDATE SET enabled = excluded.enabled",
  )
    .bind(`as_${edition}_user_${userId}`, edition, userId, enabled ? 1 : 0)
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

export async function loadSignup(env: Env, signupId: string): Promise<SignupRecord | null> {
  const row = await env.DB.prepare(
    "SELECT s.id, s.deck_id, d.name deck_name, d.edition, d.program_id, d.uploaded_by, d.founder_email, s.status, " +
      "s.signing_provider, s.sig_type, s.in_app, s.wet_ink, s.authorised_signatory_user_id, " +
      "s.authorised_signatory_role, s.founder_signed_at " +
      "FROM signups s JOIN decks d ON d.id = s.deck_id WHERE s.id = ?",
  )
    .bind(signupId)
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
  signupId: string,
  method: { provider: ESignProvider; sigType: SignatureType; inApp: boolean; wetInk: boolean },
): Promise<void> {
  await env.DB.prepare(
    "UPDATE signups SET signing_provider = ?, sig_type = ?, in_app = ?, wet_ink = ? WHERE id = ?",
  )
    .bind(method.provider, method.sigType, method.inApp ? 1 : 0, method.wetInk ? 1 : 0, signupId)
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
  signupId: string,
  assignment: SignatoryAssignment,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE signups SET authorised_signatory_role = ?, authorised_signatory_user_id = ? WHERE id = ?",
  )
    .bind(assignment.role, assignment.userId, signupId)
    .run();
}

/** Record the founder's signature — the act that locks the method. */
export async function markFounderSigned(
  env: Env,
  signupId: string,
  at: string,
): Promise<void> {
  await env.DB.batch([
    // `progress` is 0034's "founder has acted" state; a record already further
    // along keeps the status it has.
    env.DB.prepare(
      "UPDATE signups SET founder_signed_at = ?, status = CASE WHEN status = 'initiated' THEN 'progress' ELSE status END WHERE id = ?",
    ).bind(at, signupId),
    // Every agreement on this sign-up freezes with it.
    env.DB.prepare("UPDATE agreements SET method_locked = 1 WHERE signup_id = ?").bind(signupId),
  ]);
}

export async function markCountersigned(
  env: Env,
  signupId: string,
  userId: string,
  at: string,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE agreements SET countersigned_by = ?, countersigned_at = ? WHERE signup_id = ? AND countersigned_at IS NULL",
    ).bind(userId, at, signupId),
    env.DB.prepare(
      "UPDATE signups SET status = 'completed', completed_at = ? WHERE id = ? AND status IN ('initiated', 'progress')",
    ).bind(at, signupId),
  ]);
}

export async function countAgreements(env: Env, signupId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) n FROM agreements WHERE signup_id = ?")
    .bind(signupId)
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

export async function loadAgreement(env: Env, signupId: string): Promise<AgreementRow | null> {
  return env.DB.prepare(
    "SELECT id, signup_id, template_id, kind, template_url, merge_values_json, status, method_locked, " +
      "countersigned_by, countersigned_at FROM agreements WHERE signup_id = ? ORDER BY created_at LIMIT 1",
  )
    .bind(signupId)
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
  record: SignupRecord,
  template: AgreementTemplateView,
  mergeValues: Record<string, string>,
): Promise<AgreementRow> {
  const existing = await loadAgreement(env, record.row.id);
  if (existing) {
    // Merge values stay editable until the founder signs — that is what "Fill
    // blanks" is, and the lock is the same one the method has.
    if (existing.method_locked === 0) {
      await env.DB.prepare("UPDATE agreements SET merge_values_json = ? WHERE id = ?")
        .bind(JSON.stringify(mergeValues), existing.id)
        .run();
      return (await loadAgreement(env, record.row.id))!;
    }
    return existing;
  }
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
  return (await loadAgreement(env, record.row.id))!;
}

/** Record one signature against an agreement. */
export async function recordSignature(
  env: Env,
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

export async function listSignatures(
  env: Env,
  agreementId: string,
): Promise<Array<{ signerName: string | null; signerEmail: string | null; signedAt: string | null }>> {
  return (
    await env.DB.prepare(
      "SELECT signer_name signerName, signer_email signerEmail, signed_at signedAt FROM signatures " +
        "WHERE agreement_id = ? ORDER BY created_at",
    )
      .bind(agreementId)
      .all<{ signerName: string | null; signerEmail: string | null; signedAt: string | null }>()
  ).results;
}

// ── The stub's audit trail ───────────────────────────────────────────────────

export async function listAttempts(
  env: Env,
  signupId: string,
  limit = 20,
): Promise<ESignAttemptView[]> {
  const rows = (
    await env.DB.prepare(
      "SELECT id, signup_id, agreement_id, kind, provider, sig_type, recipients_json, document_name, " +
        "status, provider_reference, error, created_at FROM esign_outbox WHERE signup_id = ? " +
        "ORDER BY created_at DESC, id DESC LIMIT ?",
    )
      .bind(signupId, limit)
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
