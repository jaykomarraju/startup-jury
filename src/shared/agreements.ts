/**
 * Agreements, authorised signatories and the signing method — the vocabulary and
 * the pure rules, shared by the server (`src/server/esign/**`) and the two Admin
 * console sections (`src/client/routes/admin/AgreementsLibrary.tsx`,
 * `AuthorisedSignatories.tsx`).
 *
 * Pure: no `Env`, no DB, no `fetch`. That is what lets the console pre-validate a
 * merge-field set with the exact rules the route enforces, what lets the locked
 * signing-method card render the same sentence the server would, and what lets
 * `substituteMergeFields` be unit-tested at the node tier.
 *
 * The Env-bound half — the provider interface, the recording stub and the store —
 * is `src/server/esign/`. `src/shared/crm.ts`, `src/shared/audit.ts` and
 * `src/shared/branding.ts` are the precedent for splitting a session's
 * vocabulary out this way; this module is declared in the plan's §9 for the same
 * reason they were.
 *
 * Three prototype sources are transcribed here, and each constant says which:
 *   - `admin/s-suagr.html` + `admin/_scripts.js:340-455` — the library, its
 *     merge fields, its stage / programme mapping and its signing workflow.
 *   - `admin/s-susign.html` — signatories by role and by named individual.
 *   - `_scripts.js:2260-2296` — the per-record signing method, its
 *     lock-on-founder-signature rule, and the in-workspace signatory assign.
 */

import { ROLES_BY_EDITION, roleLabel, type Edition, type Role } from "./roles";

// ── The signing method (F0025) ───────────────────────────────────────────────

/**
 * The five providers the prototype's `eSign provider` select offers, in its
 * order (`_scripts.js:2264`). These are the values persisted on
 * `signups.signing_provider` / `signatures.method_provider`, whose CHECK
 * constraints (`migrations/0034`, `0035`) name exactly this set.
 */
export const ESIGN_PROVIDERS = ["SignDesk", "DocuSign", "Adobe", "Zoho", "eMudhra"] as const;
export type ESignProvider = (typeof ESIGN_PROVIDERS)[number];

/** Display names. Three of the five carry "Sign" in the prototype's option. */
export const ESIGN_PROVIDER_LABELS: Record<ESignProvider, string> = {
  SignDesk: "SignDesk",
  DocuSign: "DocuSign",
  Adobe: "Adobe Sign",
  Zoho: "Zoho Sign",
  eMudhra: "eMudhra",
};

/**
 * Standard vs certificate-based. This is the field that makes a signature
 * legally distinguishable, which is why both specs §8.3 name it explicitly and
 * why it is immutable once the founder has signed.
 */
export const SIGNATURE_TYPES = ["standard", "certificate"] as const;
export type SignatureType = (typeof SIGNATURE_TYPES)[number];

/** The `Signature type` select's two options, verbatim (`_scripts.js:2265`). */
export const SIGNATURE_TYPE_LABELS: Record<SignatureType, string> = {
  standard: "Standard e-signature",
  certificate: "Certificate-based (DSC / Aadhaar eSign / QES)",
};

/**
 * The short form. The prototype's locked card and the founder's mirror both
 * print `sigType.split(' (')[0]`, i.e. the label up to its parenthesis.
 */
export const SIGNATURE_TYPE_SHORT: Record<SignatureType, string> = {
  standard: "Standard e-signature",
  certificate: "Certificate-based",
};

/** The founder-facing chip on a certificate signature (`suwFounderMethod`). */
export const CERTIFICATE_CHIP = "DSC / Aadhaar / QES";

export interface SigningMethod {
  provider: ESignProvider;
  sigType: SignatureType;
  /** Fallback: sign in the app rather than at the provider. */
  inApp: boolean;
  /** Fallback: "Print, scan & upload". */
  wetInk: boolean;
}

/**
 * What a record's method is before anyone chooses one — the object
 * `suMethodCard` assigns on first render (`_scripts.js:2261`).
 *
 * NOTE the deliberate disagreement with the column defaults: `signups.wet_ink`
 * defaults to 0 in `migrations/0034`, the prototype defaults it to ON. The
 * prototype wins because it is the visual contract (§1.1), and nothing depends
 * on the column default: `PUT …/method` always writes all four fields
 * explicitly, and a row that has never been configured is reported as
 * `configured: false` and rendered from this constant.
 */
export const DEFAULT_SIGNING_METHOD: SigningMethod = {
  provider: "SignDesk",
  sigType: "standard",
  inApp: true,
  wetInk: true,
};

/** The sign-up statuses of `migrations/0034` (`signups.status`). */
export const SIGNUP_STATUSES = [
  "initiated",
  "progress",
  "completed",
  "onboarded",
  "archived",
] as const;
export type SignupStatus = (typeof SIGNUP_STATUSES)[number];

/**
 * **The immutability rule.** The prototype's guard is
 * `!d.founderSigned && ['shortlisted','initiated'].indexOf(d.signup) >= 0`
 * (`_scripts.js:2262`).
 *
 * `shortlisted` is a *deck* status in this application, not a sign-up one — a
 * shortlisted deck has no `signups` row yet, and the row is created at
 * `initiated`. So the prototype's two editable states collapse to this one, and
 * the rule reads: editable while the sign-up is still being set up and the
 * founder has not signed. `progress` already implies a founder signature (the
 * prototype's own `suwFSubmit` sets `founderSigned` and moves
 * initiated → progress in the same step), so it is correctly outside the set.
 */
export function canEditSigningMethod(record: {
  status: SignupStatus;
  founderSignedAt: string | null;
}): boolean {
  return record.founderSignedAt === null && record.status === "initiated";
}

/** Why a method is locked, in the words of the prototype's locked card. */
export function signingMethodLockReason(record: {
  status: SignupStatus;
  founderSignedAt: string | null;
}): string | null {
  if (record.founderSignedAt !== null) return "Signing method locked — founder has signed";
  if (record.status !== "initiated") return "Signing method locked";
  return null;
}

/**
 * The locked card's one-liner: `<provider> · <short type>[ · fallback: …]`
 * (`_scripts.js:2272`). The fallback words are the prototype's own.
 */
export function describeSigningMethod(m: SigningMethod): string {
  const fallbacks: string[] = [];
  if (m.inApp) fallbacks.push("in-app");
  if (m.wetInk) fallbacks.push("print/scan");
  const head = `${ESIGN_PROVIDER_LABELS[m.provider]} · ${SIGNATURE_TYPE_SHORT[m.sigType]}`;
  return fallbacks.length ? `${head} · fallback: ${fallbacks.join(", ")}` : head;
}

export function isESignProvider(v: unknown): v is ESignProvider {
  return typeof v === "string" && (ESIGN_PROVIDERS as readonly string[]).includes(v);
}

export function isSignatureType(v: unknown): v is SignatureType {
  return typeof v === "string" && (SIGNATURE_TYPES as readonly string[]).includes(v);
}

// ── Template lifecycle ───────────────────────────────────────────────────────

/** `migrations/0035`'s CHECK, in the prototype's Status-select order. */
export const TEMPLATE_STATUSES = ["active", "draft", "retired"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  active: "Active",
  draft: "Draft",
  retired: "Retired",
};

/** The prototype's Stage select, in its order (`On sign-up` is the default). */
export const TEMPLATE_STAGES = ["on_signup", "pre_signup", "post_signup"] as const;
export type TemplateStage = (typeof TEMPLATE_STAGES)[number];

export const TEMPLATE_STAGE_LABELS: Record<TemplateStage, string> = {
  pre_signup: "Pre-sign-up",
  on_signup: "On sign-up",
  post_signup: "Post-sign-up",
};

export function isTemplateStatus(v: unknown): v is TemplateStatus {
  return typeof v === "string" && (TEMPLATE_STATUSES as readonly string[]).includes(v);
}

export function isTemplateStage(v: unknown): v is TemplateStage {
  return typeof v === "string" && (TEMPLATE_STAGES as readonly string[]).includes(v);
}

/**
 * "Retired templates stay for audit but can't be picked for new sign-ups"
 * (`s-suagr.html`'s own subtitle). One predicate, so the library's opacity, the
 * sign-up template picker and the server all agree on what "unpickable" means.
 */
export function isPickable(t: { status: TemplateStatus }): boolean {
  return t.status === "active";
}

/**
 * `suVersion` (`_scripts.js:452`): read the digits out of the current label,
 * add one, and drop the template back to Draft. Transcribed rather than
 * improved — "v3" → "v4", and a label with no digits becomes "v2".
 */
export function nextVersionLabel(current: string | null | undefined): string {
  const digits = (current ?? "v1").replace(/[^0-9]/g, "");
  const n = Number.parseInt(digits, 10) || 1;
  return `v${n + 1}`;
}

// ── Merge fields ─────────────────────────────────────────────────────────────

/**
 * A merge-field key must be usable as a `{{placeholder}}` in a DOCX or PDF form
 * field, so it is restricted to the identifier shape the seeded keys already
 * use (`startup`, `founder`, `premoney`). `agreement_template_fields` carries a
 * UNIQUE (template_id, key) index; this is the format half of the same rule.
 */
export const MERGE_FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;

export interface MergeField {
  key: string;
  label: string;
  sample: string | null;
}

/** How a key appears in the uploaded source file. */
export function placeholderFor(key: string): string {
  return `{{${key}}}`;
}

/** What an unfilled blank renders as in a prepared agreement. */
export const UNFILLED_BLANK = "__________";

/** Any `{{…}}` run, however spaced. Keys are matched loosely on purpose: a
 *  placeholder the template never declared must be *reported*, not skipped. */
const PLACEHOLDER = /\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g;

export interface MergeResult {
  /** The document text with every declared, valued placeholder substituted. */
  text: string;
  /** Declared keys that received a value, in first-appearance order. */
  filled: string[];
  /** Declared keys whose value was blank — rendered as `UNFILLED_BLANK`. */
  missing: string[];
  /** Placeholders in the file the template never declared — left verbatim. */
  unknown: string[];
  /** Supplied values whose key the template never declared — never written. */
  ignored: string[];
}

/**
 * Fill a template's blanks.
 *
 * "Each field becomes an editable blank filled during agreement prep. The key
 * maps to the placeholder in the uploaded file" (`fieldsCard`'s helper line) —
 * so the declared set, not the value map, is the authority on what may be
 * substituted. Three cases, and the two that are not the happy path are the
 * reason this function exists rather than a `String.replace` at the call site:
 *
 *   - **declared, with a value** → substituted.
 *   - **declared, no value** → replaced with a visible blank and reported in
 *     `missing`. Silently emitting an empty string would produce a document
 *     that reads as complete while a term is missing from it.
 *   - **not declared** → left as `{{key}}` verbatim and reported in `unknown`.
 *     An undeclared placeholder is one no administrator ever approved as a
 *     blank; it cannot be filled, so it must stay visible in the draft.
 *
 * A supplied value whose key is not declared is never written anywhere, and is
 * reported in `ignored` — the mirror image of the third case.
 */
export function substituteMergeFields(
  text: string,
  fields: readonly MergeField[],
  values: Readonly<Record<string, string | null | undefined>>,
): MergeResult {
  const declared = new Map(fields.map((f) => [f.key, f]));
  const filled: string[] = [];
  const missing: string[] = [];
  const unknown: string[] = [];

  const seen = (list: string[], key: string) => {
    if (!list.includes(key)) list.push(key);
  };

  const out = text.replace(PLACEHOLDER, (whole, rawKey: string) => {
    const key = rawKey.trim();
    if (!declared.has(key)) {
      seen(unknown, key);
      return whole;
    }
    const value = values[key];
    if (typeof value === "string" && value.trim() !== "") {
      seen(filled, key);
      return value;
    }
    seen(missing, key);
    return UNFILLED_BLANK;
  });

  const ignored = Object.keys(values).filter((k) => !declared.has(k));

  return { text: out, filled, missing, unknown, ignored };
}

export type MergeFieldCheck =
  | { ok: true; fields: MergeField[] }
  | { ok: false; reason: "empty_key" | "bad_key" | "duplicate_key" | "empty_label"; key: string };

/** The rules `PUT /api/esign/templates/:id` enforces, run client-side too. */
export function validateMergeFields(fields: readonly MergeField[]): MergeFieldCheck {
  const clean: MergeField[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const key = f.key.trim().toLowerCase();
    const label = f.label.trim();
    if (key === "") return { ok: false, reason: "empty_key", key: label };
    if (!MERGE_FIELD_KEY.test(key)) return { ok: false, reason: "bad_key", key };
    if (seen.has(key)) return { ok: false, reason: "duplicate_key", key };
    if (label === "") return { ok: false, reason: "empty_label", key };
    seen.add(key);
    clean.push({ key, label, sample: f.sample?.trim() ? f.sample.trim() : null });
  }
  return { ok: true, fields: clean };
}

export function describeMergeFieldError(check: MergeFieldCheck): string {
  if (check.ok) return "";
  switch (check.reason) {
    case "empty_key":
      return "Every merge field needs a key — it is what maps to the placeholder in the file.";
    case "bad_key":
      return `"${check.key}" isn't a usable key. Use lower-case letters, digits and underscores, starting with a letter.`;
    case "duplicate_key":
      return `"${check.key}" is used by two merge fields. Each key maps to one placeholder.`;
    case "empty_label":
      return `"${check.key}" has no label. The label is what the person filling the blank reads.`;
  }
}

// ── The signing workflow ─────────────────────────────────────────────────────

export const FLOW_ACTIONS = ["fill_blanks", "sign_first", "countersign"] as const;
export type FlowAction = (typeof FLOW_ACTIONS)[number];

/** `SU_ACTS` (`_scripts.js:342`), verbatim. */
export const FLOW_ACTION_LABELS: Record<FlowAction, string> = {
  fill_blanks: "Fill blanks",
  sign_first: "Sign first",
  countersign: "Countersign",
};

export function isFlowAction(v: unknown): v is FlowAction {
  return typeof v === "string" && (FLOW_ACTIONS as readonly string[]).includes(v);
}

/**
 * Who a step belongs to. `agreement_flow_steps.actor_role` holds a role id or
 * the literal `'founder'` (`migrations/0035`); the incubator's `Role` union
 * already contains `founder`, the VC's does not, so the actor type is stated
 * once here rather than inferred per edition.
 */
export type FlowActor = Role | "founder";

/** `SU_ROLES` for an edition — the platform's role order, founder last. */
export function flowActors(edition: Edition): FlowActor[] {
  const staff = ROLES_BY_EDITION[edition].filter((r) => r !== "founder");
  return [...staff, "founder"];
}

export function flowActorLabel(edition: Edition, actor: FlowActor): string {
  return actor === "founder" ? "Startup founder" : roleLabel(edition, actor as Role);
}

export function isFlowActor(edition: Edition, v: unknown): v is FlowActor {
  return typeof v === "string" && (flowActors(edition) as string[]).includes(v);
}

export interface FlowStep {
  actor: FlowActor;
  action: FlowAction;
}

/**
 * A workflow is a chain, and two of its properties are load-bearing rather than
 * cosmetic: the founder must sign before anyone countersigns (that is what
 * "countersign" means), and a template may have at most one countersign step
 * because `agreements.countersigned_by` is a single column.
 */
export type FlowCheck =
  | { ok: true; steps: FlowStep[] }
  | { ok: false; reason: "empty" | "countersign_before_signature" | "two_countersigns" };

export function validateFlow(steps: readonly FlowStep[]): FlowCheck {
  if (steps.length === 0) return { ok: false, reason: "empty" };
  const countersigns = steps.filter((s) => s.action === "countersign");
  if (countersigns.length > 1) return { ok: false, reason: "two_countersigns" };
  const firstSignature = steps.findIndex((s) => s.action === "sign_first");
  const countersign = steps.findIndex((s) => s.action === "countersign");
  if (countersign >= 0 && (firstSignature < 0 || countersign < firstSignature)) {
    return { ok: false, reason: "countersign_before_signature" };
  }
  return { ok: true, steps: steps.map((s) => ({ ...s })) };
}

export function describeFlowError(check: FlowCheck): string {
  if (check.ok) return "";
  switch (check.reason) {
    case "empty":
      return "A template needs at least one signing step.";
    case "two_countersigns":
      return "Only one step may countersign — that is the step the authorised signatory performs.";
    case "countersign_before_signature":
      return "A countersign step has to come after the step that signs first.";
  }
}

/** The prototype's default chain for a brand-new template (`suAdd`). */
export function defaultFlow(edition: Edition): FlowStep[] {
  return edition === "vc"
    ? [
        { actor: "associate", action: "fill_blanks" },
        { actor: "founder", action: "sign_first" },
        { actor: "superuser", action: "countersign" },
      ]
    : [
        { actor: "program_associate", action: "fill_blanks" },
        { actor: "founder", action: "sign_first" },
        { actor: "superuser", action: "countersign" },
      ];
}

// ── Authorised signatories ───────────────────────────────────────────────────

export interface SignatoryRoleGrant {
  role: Role;
  label: string;
  enabled: boolean;
}

export interface SignatoryUserGrant {
  userId: string;
  name: string;
  /** The person's role label — the prototype's `.tr-sub`. */
  roleLabel: string;
  role: Role;
  enabled: boolean;
}

/** Everything `s-susign.html` administers, and everything the picker reads. */
export interface SignatoryPool {
  roles: SignatoryRoleGrant[];
  users: SignatoryUserGrant[];
}

/**
 * Who is assigned to countersign one record — `signups.authorised_signatory_role`
 * or `…_user_id` (the role column is `migrations/0049`'s; 0034 shipped only the
 * user one, and the prototype's picker offers both).
 */
export interface SignatoryAssignment {
  role: Role | null;
  userId: string | null;
}

export const UNASSIGNED: SignatoryAssignment = { role: null, userId: null };

export function isAssigned(a: SignatoryAssignment): boolean {
  return a.role !== null || a.userId !== null;
}

/**
 * "Only those enabled here appear in the sign-up countersign picker"
 * (`s-susign.html`). The picker is therefore a projection of the pool, not a
 * separate list — which is the whole point of F0008.
 */
export function assignableOptions(pool: SignatoryPool): {
  byRole: SignatoryRoleGrant[];
  named: SignatoryUserGrant[];
} {
  return {
    byRole: pool.roles.filter((r) => r.enabled),
    named: pool.users.filter((u) => u.enabled),
  };
}

/** The picker's own option labels (`suAssignCard`): "<Role> (any)", "<Name> — <Role>". */
export function roleOptionLabel(grant: SignatoryRoleGrant): string {
  return `${grant.label} (any)`;
}

export function userOptionLabel(grant: SignatoryUserGrant): string {
  return `${grant.name} — ${grant.roleLabel}`;
}

/** How an assignment reads once made — the locked card's `<b>` line. */
export function describeAssignment(
  pool: SignatoryPool,
  a: SignatoryAssignment,
): string {
  if (a.userId) {
    const u = pool.users.find((x) => x.userId === a.userId);
    return u ? userOptionLabel(u) : "Not assigned";
  }
  if (a.role) {
    const r = pool.roles.find((x) => x.role === a.role);
    return r ? roleOptionLabel(r) : "Not assigned";
  }
  return "Not assigned";
}

export type CountersignRefusal = "no_signatory" | "not_the_signatory" | "not_authorised";

/**
 * **The countersign gate** (F0008, specs §8.3: "an Authorised signatory must be
 * assigned in-workspace before countersign is enabled").
 *
 * The prototype expresses it as a disabled button with the line "Assign an
 * authorised signatory to countersign." (`_scripts.js:2038`). It is enforced
 * here so the API refuses it too — a gate that only exists in the button is not
 * a gate.
 *
 * Three ways to fail, in the order an operator would want to be told:
 *   - nothing is assigned at all;
 *   - someone else is assigned (a named individual, or another role);
 *   - the assignment names a grant that has since been switched OFF in the
 *     Admin console, so nobody may act on it until it is re-granted.
 */
export function countersignRefusal(
  pool: SignatoryPool,
  assignment: SignatoryAssignment,
  caller: { id: string; role: Role },
): CountersignRefusal | null {
  if (!isAssigned(assignment)) return "no_signatory";
  if (assignment.userId) {
    if (assignment.userId !== caller.id) return "not_the_signatory";
    const grant = pool.users.find((u) => u.userId === assignment.userId);
    return grant?.enabled ? null : "not_authorised";
  }
  if (assignment.role !== caller.role) return "not_the_signatory";
  const grant = pool.roles.find((r) => r.role === assignment.role);
  return grant?.enabled ? null : "not_authorised";
}

export function describeCountersignRefusal(reason: CountersignRefusal): string {
  switch (reason) {
    case "no_signatory":
      return "Assign an authorised signatory to countersign.";
    case "not_the_signatory":
      return "Someone else is assigned to countersign this agreement.";
    case "not_authorised":
      return "That signatory is no longer enabled in Admin → Authorised signatories.";
  }
}

// ── Edition wording ──────────────────────────────────────────────────────────

/**
 * The incubator maps templates to programmes and cohorts; the VC edition maps
 * them to funds. Same table, different noun — the only textual difference
 * between the two builds of `s-suagr.html`, and the label the "Applies to" card
 * prints (`_scripts.js:410`).
 */
export function programmeNoun(edition: Edition): { plural: string; card: string } {
  return edition === "vc"
    ? { plural: "funds", card: "Funds" }
    : { plural: "programs", card: "Programs / cohorts" };
}

/** `s-suagr.html`'s `.sec-sub`, per edition. */
export function libraryBlurb(edition: Edition): string {
  const noun = edition === "vc" ? "funds" : "programs";
  return (
    `Manage the agreement templates used in sign-up — upload the source file, mark its merge ` +
    `fields, map it to ${noun} and stages, and define the signing workflow. Retired templates ` +
    `stay for audit but can't be picked for new sign-ups.`
  );
}

/** `s-susign.html`'s `.sec-sub`, per edition ("organisation" vs "firm"). */
export function signatoriesBlurb(edition: Edition): string {
  const whose = edition === "vc" ? "firm's" : "organisation's";
  return (
    `Who may countersign agreements on the ${whose} behalf. Grant by role, by named individual, ` +
    `or both. Only those enabled here appear in the sign-up countersign picker.`
  );
}

// ── Views (the API's wire shapes) ────────────────────────────────────────────

export interface AgreementTemplateView {
  id: string;
  edition: Edition;
  code: string;
  name: string;
  fileName: string | null;
  /** True when a source file has actually been uploaded to R2. */
  fileStored: boolean;
  version: string;
  status: TemplateStatus;
  stage: TemplateStage;
  fields: MergeField[];
  /** Programme ids this template is offered on. */
  programIds: string[];
  /** Their names, for the list's summary line. */
  programNames: string[];
  flow: FlowStep[];
  createdAt: string;
  updatedAt: string | null;
  /** Agreements raised from this template — why a used template can only retire. */
  agreementCount: number;
}

export interface ProgrammeOptionView {
  id: string;
  name: string;
}

/**
 * The list row's `.crm-sub`:
 * `<file> · <ver> · N merge fields · <programmes | "unmapped">` (`suList`).
 *
 * The prototype writes "merge fields" even for one; this pluralises, which is
 * the only intentional wording change in either section.
 */
export function templateSummary(t: {
  fileName: string | null;
  version: string;
  fields: readonly unknown[];
  programNames: readonly string[];
}): string {
  const file = t.fileName ?? "(no file yet)";
  const count = t.fields.length;
  const fields = `${count} merge field${count === 1 ? "" : "s"}`;
  const mapped = t.programNames.length ? t.programNames.join(", ") : "unmapped";
  return `${file} · ${t.version} · ${fields} · ${mapped}`;
}

export interface SigningMethodView extends SigningMethod {
  signupId: string;
  deckId: string;
  deckName: string;
  status: SignupStatus;
  founderSignedAt: string | null;
  /** False while the record still carries no chosen provider. */
  configured: boolean;
  editable: boolean;
  lockReason: string | null;
  assignment: SignatoryAssignment;
  assignmentLabel: string;
}

/** One recorded e-signature attempt — the §1.3 stub's audit row. */
export interface ESignAttemptView {
  id: string;
  signupId: string | null;
  agreementId: string | null;
  kind: string;
  provider: ESignProvider;
  sigType: SignatureType;
  status: "sent" | "failed" | "recorded";
  recipients: string[];
  documentName: string | null;
  providerReference: string | null;
  error: string | null;
  createdAt: string;
}
