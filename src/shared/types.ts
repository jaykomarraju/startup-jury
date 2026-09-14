/**
 * Shared row types and seed vocabularies for the schema the parity programme
 * needs (migrations `0025` – `0037`, W1-B).
 *
 * Everything here is **data about the schema**: the row shape each table
 * persists, and the constant sets its CHECK constraints enforce. No queries, no
 * routes — the sessions that own those surfaces import from here so the client,
 * the worker and the migration all agree on one vocabulary.
 *
 * Deliberately imports only from `./roles`, so any module may import it without
 * risking a cycle. In particular `nav.ts` may import this file; this file must
 * never import `nav.ts`. The permission matrix below is therefore a literal,
 * and `test/unit/permissions.test.ts` re-derives it from `nav.ts` + `pipeline/`
 * to prove the literal still matches what the application actually allows.
 */
import type { Edition, Role } from "./roles";

// ═══════════════════════════════════════════════════════════════════════════
// 1. Task permissions — `role_permissions` (migration 0029)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The Admin console's **Task permissions** grid (`admin/s-tm.html`): 21 tasks ×
 * 5 roles for the incubator workspace, 24 × 6 for the investor one. Task ids
 * are the prototype's own (`taskFlow` / `taskInc` / `taskInv` / `taskAfter` in
 * the admin script) so the two can be compared line by line.
 */
export const PERMISSION_TASK_GROUPS = ["General tasks", "Evaluations", "User management"] as const;
export type PermissionTaskGroup = (typeof PERMISSION_TASK_GROUPS)[number];

export interface PermissionTask {
  id: string;
  label: string;
  group: PermissionTaskGroup;
  /** Editions whose matrix includes this task. */
  editions: readonly Edition[];
  /**
   * How the seed was derived, and what the permission gates once `W3-A` reads
   * this table:
   *   `nav`    — the listed nav slugs. The grant is the union of the roles that
   *              can reach any of them today.
   *   `action` — the listed pipeline transition actions.
   *   `route`  — a server route with no nav slug of its own.
   *   `none`   — the product has no such capability yet; the seed is the
   *              prototype's own default column and nothing enforces it until
   *              the owning session builds the verb.
   */
  source: "nav" | "action" | "route" | "none";
  navSlugs?: readonly string[];
  actions?: readonly string[];
  note?: string;
}

const BOTH: readonly Edition[] = ["incubator", "vc"];
const INC: readonly Edition[] = ["incubator"];
const VC: readonly Edition[] = ["vc"];

export const PERMISSION_TASKS: readonly PermissionTask[] = [
  // ── Workflow tasks common to both editions (prototype `taskFlow`) ─────────
  { id: "register", label: "Register", group: "General tasks", editions: BOTH, source: "none",
    note: "Account registration happens before sign-in; no in-app surface yet." },
  { id: "upgrade", label: "Purchase/Upgrade plan", group: "General tasks", editions: BOTH,
    source: "nav", navSlugs: ["billing"] },
  { id: "upload", label: "Upload", group: "Evaluations", editions: BOTH, source: "nav", navSlugs: ["upload"] },
  { id: "evaluate", label: "Evaluate", group: "Evaluations", editions: BOTH, source: "nav",
    navSlugs: ["evaluate", "jassigned"],
    note: "`jassigned` is the jury's own evaluation surface (role-exclusive)." },
  { id: "assign", label: "Assign / Submit", group: "Evaluations", editions: BOTH, source: "nav", navSlugs: ["assign"] },
  { id: "reassign", label: "Reassign / Resubmit", group: "Evaluations", editions: BOTH, source: "none",
    note: "Named by the prototype matrix; no verb in the product yet (W3-A)." },
  { id: "remind", label: "Remind", group: "Evaluations", editions: BOTH, source: "none",
    note: "Named by the prototype matrix; no verb in the product yet (W3-A)." },
  { id: "query", label: "Query", group: "Evaluations", editions: BOTH, source: "nav", navSlugs: ["query"] },
  { id: "introcall", label: "Intro call", group: "Evaluations", editions: BOTH, source: "nav", navSlugs: ["introcalls"] },

  // ── Incubator-only workflow tasks (prototype `taskInc`) ───────────────────
  { id: "jurypipeline", label: "Jury pipeline", group: "Evaluations", editions: INC, source: "nav", navSlugs: ["jurypipeline"] },
  { id: "shortlistsignup", label: "Program manager pipeline", group: "Evaluations", editions: INC,
    source: "nav", navSlugs: ["pmpipeline"] },
  { id: "signuppipeline", label: "Sign up pipeline", group: "Evaluations", editions: INC,
    source: "nav", navSlugs: ["incuration"] },

  // ── VC-only workflow tasks (prototype `taskInv`) ──────────────────────────
  { id: "assocpipeline", label: "Assoc. pipeline", group: "Evaluations", editions: VC,
    source: "nav", navSlugs: ["jurypipeline"], note: "VC labels the slug `jurypipeline` \"Assoc. Pipeline\"." },
  { id: "partnerpipeline", label: "Partner pipeline", group: "Evaluations", editions: VC,
    source: "nav", navSlugs: ["partnerpipeline"] },
  { id: "icpipeline", label: "IC pipeline", group: "Evaluations", editions: VC, source: "nav", navSlugs: ["icpipeline"] },
  { id: "mpapproval", label: "MP approval", group: "Evaluations", editions: VC,
    source: "action", actions: ["mp_approve_dd"], note: "No nav slug of its own; it is a gate on Investment DD." },
  { id: "openchecklist", label: "Open checklist", group: "Evaluations", editions: VC,
    source: "nav", navSlugs: ["investmentdd", "legaldd"] },
  { id: "signup", label: "Sign up", group: "Evaluations", editions: VC,
    source: "nav", navSlugs: ["incuration"], note: "VC labels the slug `incuration` \"Term sheet Pipeline\"." },

  // ── Onboard: both editions, different slug owners ─────────────────────────
  { id: "onboard", label: "Onboard", group: "Evaluations", editions: BOTH, source: "nav", navSlugs: ["curation"] },

  // ── Tasks that follow the workflow (prototype `taskAfter`) ────────────────
  { id: "archive", label: "Archive", group: "General tasks", editions: BOTH, source: "nav", navSlugs: ["archive"] },
  { id: "activateuser", label: "Activate user", group: "User management", editions: BOTH, source: "none",
    note: "Named by the prototype matrix; no verb in the product yet (W4-A)." },
  { id: "deactivateuser", label: "Deactivate user", group: "User management", editions: BOTH, source: "none",
    note: "Named by the prototype matrix; no verb in the product yet (W4-A)." },
  { id: "deleteuser", label: "Delete user", group: "User management", editions: BOTH, source: "none",
    note: "Named by the prototype matrix; no verb in the product yet (W4-A)." },
  { id: "configparams", label: "Configure 3 additional parameters", group: "General tasks", editions: BOTH,
    source: "route",
    note: "W3-A reclassified this from `nav`/`coreparams`. The task is named for the ADDITIONAL "
      + "parameters, which have no sidebar item of their own — they are configured on `myparams` "
      + "(visible to every internal role already) and permitted per row from the console's Area "
      + "weights. `coreparams` is the core-13 rubric screen, a different surface that stays "
      + "admin-only. Enforced on POST/PUT/DELETE /api/config/additional-params*." },
  { id: "adminconsole", label: "Access to admin console", group: "General tasks", editions: BOTH,
    source: "nav", navSlugs: ["admin"] },
  { id: "addmembers", label: "Permit to add team members", group: "General tasks", editions: BOTH,
    source: "route", note: "POST /api/users — requireRole(\"admin\")." },
  { id: "outofofficedelegation", label: "Out of office delegation", group: "General tasks", editions: BOTH,
    source: "none", note: "Named by the prototype matrix; no verb in the product yet (W3-A)." },
];

/**
 * Roles the matrix covers, in the prototype's column order. `founder` is
 * deliberately absent: founders are external actors whose isolation is a
 * security invariant (`scripts/role-matrix.ts` §B asserts it), not an
 * administrator's toggle. `mentor` is absent for the same reason it is absent
 * from `Role` — it is a directory record, not an actor.
 */
export const PERMISSION_ROLES: Record<Edition, readonly Role[]> = {
  incubator: ["superuser", "admin", "program_manager", "program_associate", "jury"],
  vc: ["superuser", "admin", "partner", "ic_member", "associate", "analyst"],
};

/**
 * The seeded matrix: for each edition, the roles granted each task.
 *
 * **Gate, not grant.** A `false` cell removes a capability the role would
 * otherwise have; a `true` cell leaves the application's existing, finer rules
 * (pipeline transition role lists, `requireRole`, stage gating) untouched. That
 * is what lets the seed reproduce today's behaviour exactly — `npm run roles`
 * stays 526 / 526 — while still making every cell meaningful to toggle.
 *
 * Derivation, per `PermissionTask.source`:
 *   `nav` / `action` / `route` → the roles that can reach it in the shipped app
 *      today (superuser included via its bypass).
 *   `none` → the prototype's own default column, since there is nothing in the
 *      product to contradict.
 *
 * Where the two disagree the shipped app wins (see §8 of docs/plan_parity.md):
 * the prototype's "Client admin" column has no upload / evaluate / assign /
 * query, but this application's `admin` role has had those since Phase 1.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Edition, Record<string, readonly Role[]>> = {
  incubator: {
    register: ["superuser", "admin"],
    upgrade: ["superuser", "admin"],
    upload: ["superuser", "admin", "program_manager", "program_associate"],
    evaluate: ["superuser", "admin", "program_manager", "program_associate", "jury"],
    assign: ["superuser", "admin", "program_manager", "program_associate"],
    reassign: ["superuser", "program_manager"],
    remind: ["superuser", "program_manager", "program_associate"],
    query: ["superuser", "admin", "program_manager", "program_associate"],
    introcall: ["superuser", "admin", "program_manager", "program_associate", "jury"],
    jurypipeline: ["superuser", "admin", "program_manager", "jury"],
    shortlistsignup: ["superuser", "admin", "program_manager"],
    // §8 Q5 / F0919 / F0926 — the PM reaches both post-intro-call stages (0040).
    signuppipeline: ["superuser", "admin", "program_manager", "program_associate"],
    onboard: ["superuser", "admin", "program_manager", "program_associate"],
    archive: ["superuser", "admin", "program_manager", "program_associate", "jury"],
    activateuser: ["superuser", "admin", "program_manager"],
    deactivateuser: ["superuser", "admin", "program_manager"],
    deleteuser: ["superuser", "admin"],
    // §8 Q6 / F0063 / F0080 — spec §10's default editor set, not the live
    // console's narrower one (§1.1 ranks the spec higher). 0040.
    configparams: ["superuser", "admin", "program_manager"],
    adminconsole: ["superuser", "admin"],
    addmembers: ["superuser", "admin"],
    outofofficedelegation: ["superuser", "admin", "program_manager"],
  },
  vc: {
    register: ["superuser", "admin"],
    upgrade: ["superuser", "admin"],
    upload: ["superuser", "admin", "partner", "associate", "analyst"],
    evaluate: ["superuser", "admin", "partner", "ic_member", "associate", "analyst"],
    assign: ["superuser", "admin", "associate", "analyst"],
    reassign: ["superuser", "partner", "associate"],
    remind: ["superuser", "partner", "associate", "analyst"],
    // W7-C — the partner raises founder queries (0056).
    query: ["superuser", "admin", "partner", "associate", "analyst"],
    introcall: ["superuser", "admin", "partner", "ic_member", "associate", "analyst"],
    assocpipeline: ["superuser", "admin", "associate"],
    partnerpipeline: ["superuser", "admin", "partner", "ic_member"],
    // F0917 — the partner votes, so the partner reaches IC Pipeline (0040).
    icpipeline: ["superuser", "admin", "partner", "ic_member"],
    mpapproval: ["superuser", "partner"],
    openchecklist: ["superuser", "admin", "partner", "ic_member"],
    signup: ["superuser", "admin", "partner"],
    onboard: ["superuser", "admin", "partner", "ic_member"],
    archive: ["superuser", "admin", "partner", "ic_member", "associate", "analyst"],
    activateuser: ["superuser", "admin", "partner", "associate"],
    deactivateuser: ["superuser", "admin", "partner", "associate"],
    deleteuser: ["superuser", "admin"],
    // §8 Q6 / F0080 — vc spec §10: "Super Users, Partners and Fund Admins". 0040.
    configparams: ["superuser", "admin", "partner"],
    adminconsole: ["superuser", "admin"],
    addmembers: ["superuser", "admin"],
    outofofficedelegation: ["superuser", "admin", "partner", "associate"],
  },
};

/** Tasks in the matrix for one edition, in the prototype's row order. */
export function permissionTasksFor(edition: Edition): PermissionTask[] {
  return PERMISSION_TASKS.filter((t) => t.editions.includes(edition));
}

export interface RolePermissionRow {
  edition: Edition;
  role: Role;
  task_id: string;
  granted: number;
  updated_at: string;
  updated_by: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Org scoring settings — `org_scoring_settings` (migration 0026)
// ═══════════════════════════════════════════════════════════════════════════

export const SCORE_SCALES = ["0-10", "1-5", "0-100"] as const;
export type ScoreScale = (typeof SCORE_SCALES)[number];

export const COMPOSITE_FORMULAS = ["weighted_average", "unweighted_average", "median"] as const;
export type CompositeFormula = (typeof COMPOSITE_FORMULAS)[number];

/** The AI/human splits the prototype's "AI weight in composite" select offers. */
export const AI_WEIGHT_CHOICES = [40, 30, 50, 0] as const;

export interface OrgScoringSettingsRow {
  edition: Edition;
  ai_pre_scoring_enabled: number;
  auto_clarification: number;
  show_ai_score_to_jury: number;
  require_override_rationale: number;
  override_rationale_delta: number;
  jury_sees_peer_scores: number;
  score_scale: ScoreScale;
  composite_formula: CompositeFormula;
  ai_weight_pct: number;
  shortlist_threshold: number;
  show_three_score_view: number;
  show_score_drift: number;
  include_ai_evidence: number;
  intro_call_ai_prompts: number;
  updated_at: string;
  updated_by: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Rubric anchors & question bank (migrations 0027 – 0028)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The specs' five-band scale (§7), highest band first — `band_index` 0 … 4.
 *
 * **This is the one band table.** `shared/scoring.ts` (`signalTag`) and
 * `shared/analytics.ts` (the score distribution) both derive from it, and
 * `parameter_rubric_bands` (0027) stores the per-parameter anchor text against
 * the same `band_index`. W2-B added `key` — the machine value persisted in
 * `decks.signal` — and dropped the global four-band `rubric_anchors` table from
 * 0001 in `0039`, which was the §1.5 defect: two scales, two sets of labels.
 *
 * `min` is the spec's `band(v)` cut-point: the first band whose `min` a score
 * reaches wins (v≥9 Exceptional, v≥7 Strong, v≥5 Moderate, v≥3 Weak, else
 * Insufficient). Never test `max` — scores carry half-steps, so 8.5 is Strong.
 */
export const RUBRIC_BANDS = [
  { index: 0, key: "exceptional", label: "9–10", name: "Exceptional", min: 9, max: 10 },
  { index: 1, key: "strong", label: "7–8", name: "Strong", min: 7, max: 8 },
  { index: 2, key: "moderate", label: "5–6", name: "Moderate", min: 5, max: 6 },
  { index: 3, key: "weak", label: "3–4", name: "Weak", min: 3, max: 4 },
  { index: 4, key: "insufficient", label: "0–2", name: "Insufficient", min: 0, max: 2 },
] as const;

/** The persisted band value — `decks.signal`, and `signalTag()`'s return. */
export type RubricBandKey = (typeof RUBRIC_BANDS)[number]["key"];

/** The band a 0–10 score falls in, per specs §7 `band(v)`. */
export function rubricBand(value: number): (typeof RUBRIC_BANDS)[number] {
  return RUBRIC_BANDS.find((b) => value >= b.min) ?? RUBRIC_BANDS[RUBRIC_BANDS.length - 1];
}

export interface ParameterRubricBandRow {
  id: string;
  parameter_id: string;
  band_index: number;
  band_label: string;
  band_name: string;
  min_score: number;
  max_score: number;
  description: string | null;
}

export interface QuestionBankRow {
  id: string;
  parameter_id: string;
  seq: number;
  text: string;
  active: number;
  created_at: string;
}

/** Areas whose bank is eight questions rather than five (BRD / `s-qb.html`). */
export const QUESTION_BANK_LARGE_AREAS = ["climate_impact"] as const;

// ═══════════════════════════════════════════════════════════════════════════
// 4. Audit log — `audit_log` (migration 0030)
// ═══════════════════════════════════════════════════════════════════════════

/** The four badge colours the prototype's audit rows carry (`s-al.html`). */
export const AUDIT_CATEGORIES = ["config", "score", "team", "billing", "pipeline", "security"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export interface AuditLogRow {
  id: string;
  edition: Edition;
  category: AuditCategory;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  summary: string;
  detail_json: string | null;
  /** NULL for config / team / billing events — the whole point of this table. */
  deck_id: string | null;
  target_type: string | null;
  target_id: string | null;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Notification preferences — `notification_preferences` (migration 0031)
// ═══════════════════════════════════════════════════════════════════════════

export const NOTIFICATION_CHANNELS = ["email", "in_app"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export interface NotificationEvent {
  key: string;
  /** Per-edition label: the prototype renames one event for the VC build. */
  label: Record<Edition, string>;
  sub?: string;
  /** The prototype's email-column default. */
  defaultOn: boolean;
}

/** The ten events on `admin/s-nt.html`, in the order the prototype lists them. */
export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  { key: "deck_submitted", label: { incubator: "New pitchdeck submitted", vc: "New pitchdeck submitted" }, defaultOn: true },
  { key: "ai_scoring_complete", label: { incubator: "AI scoring complete", vc: "AI scoring complete" },
    sub: "Deck has been parsed and pre-scored by the AI engine", defaultOn: true },
  { key: "evaluator_scores_submitted",
    label: { incubator: "Jury member submitted scores", vc: "IC member submitted scores" }, defaultOn: true },
  { key: "all_evaluations_complete",
    label: { incubator: "All jury complete — ready for mentor review", vc: "All jury complete — ready for mentor review" },
    defaultOn: true },
  { key: "founder_responded",
    label: { incubator: "Startup responded to clarification questions", vc: "Startup responded to clarification questions" },
    defaultOn: false },
  { key: "intro_call_scheduled",
    label: { incubator: "Intro call scheduled or rescheduled", vc: "Intro call scheduled or rescheduled" }, defaultOn: true },
  { key: "credits_low", label: { incubator: "Credit balance low — under 10 credits", vc: "Credit balance low — under 10 credits" },
    defaultOn: true },
  { key: "crm_sync_failed", label: { incubator: "CRM sync error or failure", vc: "CRM sync error or failure" }, defaultOn: true },
  { key: "invite_accepted", label: { incubator: "New team member accepted invite", vc: "New team member accepted invite" },
    defaultOn: false },
  { key: "monthly_usage_summary", label: { incubator: "Monthly usage summary report", vc: "Monthly usage summary report" },
    defaultOn: true },
];

/** Below this balance `credits_low` fires (the event's own copy names it). */
export const CREDITS_LOW_THRESHOLD = 10;

export interface NotificationPreferenceRow {
  id: string;
  edition: Edition;
  /** NULL = the workspace default every user inherits until they override it. */
  user_id: string | null;
  event_key: string;
  channel: NotificationChannel;
  enabled: number;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Credits & pricing (migrations 0032 – 0033)
// ═══════════════════════════════════════════════════════════════════════════

/** Spec §12: `credit_ledger.reason`, widened for the refund path already shipped. */
export const CREDIT_REASONS = [
  "trial_grant", "purchase", "deck_evaluated", "refund", "adjustment", "expiry",
] as const;
export type CreditReason = (typeof CREDIT_REASONS)[number];

export interface CreditLedgerRow {
  id: string;
  edition: Edition;
  /** Signed: negative debits, positive credits. */
  delta: number;
  reason: CreditReason;
  deck_id: string | null;
  /** Minor units (paise / cents) of `currency`, for the usage-history money column. */
  amount_minor: number | null;
  currency: string | null;
  reference: string | null;
  note: string | null;
  actor_id: string | null;
  created_at: string;
}

export const PRICE_PLAN_GROUPS = ["free_trial", "subscription", "credit_pack", "enterprise"] as const;
export type PricePlanGroup = (typeof PRICE_PLAN_GROUPS)[number];

/** The seven currencies the price-configuration page activates. INR is base. */
export const PRICING_BASE_CURRENCY = "INR";
export const PRICING_CURRENCIES = ["INR", "USD", "GBP", "EUR", "AED", "SGD", "AUD"] as const;

export interface CurrencyRow {
  code: string;
  symbol: string;
  flag: string;
  active: number;
  sort_order: number;
}

export interface FxRateRow {
  currency: string;
  base_currency: string;
  /** 1 base unit = `rate` units of `currency`. */
  rate: number;
  source: "live" | "manual";
  updated_at: string;
}

export interface PricePlanRow {
  id: string;
  plan_group: PricePlanGroup;
  code: string;
  name: string;
  badge: string | null;
  tagline: string | null;
  features: string | null;
  /** Decks included, for packs and enterprise tiers; NULL for subscriptions. */
  units: number | null;
  /** Billing period, where one applies. */
  period: "month" | "year" | "one_time" | null;
  saving_pct: number | null;
  active: number;
  sort_order: number;
}

export interface PriceAmountRow {
  id: string;
  plan_id: string;
  currency: string;
  /** Minor units, so no float ever touches money. */
  amount_minor: number;
  /** Set when an admin types over the FX-derived figure. */
  overridden: number;
  per_unit_label: string | null;
}

export interface PricingSettingsRow {
  id: number;
  gst_rate_pct: number;
  gst_registration: string | null;
  prices_include_gst: number;
  show_international_tax_notice: number;
  free_trial_decks: number;
  /** 0 = free-trial credits never expire. */
  free_trial_expiry_days: number;
  show_free_trial: number;
  published_at: string | null;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Sign-up, documents, agreements, signatures (migrations 0034 – 0035)
// ═══════════════════════════════════════════════════════════════════════════

/** Spec §8.2 — the sign-up funnel a deck walks. */
export const SIGNUP_STATUSES = ["initiated", "progress", "completed", "onboarded", "archived"] as const;
export type SignupStatus = (typeof SIGNUP_STATUSES)[number];

/** Spec §8.3 — one document's lifecycle, in order. Skipping is illegal. */
export const DOCUMENT_STATUSES = ["not_requested", "awaiting", "submitted", "verified"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Spec §8.3 / §8.3 (VC) — the signing-method model, locked once the founder signs. */
export const SIGNING_PROVIDERS = ["SignDesk", "DocuSign", "Adobe", "Zoho", "eMudhra"] as const;
export type SigningProvider = (typeof SIGNING_PROVIDERS)[number];

export const SIGNATURE_TYPES = ["standard", "certificate"] as const;
export type SignatureType = (typeof SIGNATURE_TYPES)[number];

export const SIGNATURE_TYPE_LABELS: Record<SignatureType, string> = {
  standard: "Standard e-signature",
  certificate: "Certificate (DSC/Aadhaar/QES)",
};

export const AGREEMENT_STATUSES = ["draft", "active", "retired"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

/** When in the journey a template is served (`s-suagr.html`'s stage select). */
export const AGREEMENT_STAGES = ["pre_signup", "on_signup", "post_signup"] as const;
export type AgreementStage = (typeof AGREEMENT_STAGES)[number];

/** The three steps the prototype's signing-workflow builder offers. */
export const AGREEMENT_FLOW_ACTIONS = ["fill_blanks", "sign_first", "countersign"] as const;
export type AgreementFlowAction = (typeof AGREEMENT_FLOW_ACTIONS)[number];

export interface SignupRow {
  id: string;
  deck_id: string;
  status: SignupStatus;
  signing_provider: SigningProvider | null;
  sig_type: SignatureType | null;
  in_app: number;
  wet_ink: number;
  /** Spec §8.3: countersign stays disabled until this is set. */
  authorised_signatory_user_id: string | null;
  /** Spec §8.3: a PM's workspace is read-only until a superuser/admin assigns them. */
  assigned_user_id: string | null;
  /** Completed without a seat — the prototype's `seatless` flag (`s-suseat.html`). */
  seatless: number;
  seat_allocated_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface SignupDocumentRow {
  id: string;
  signup_id: string;
  /** NULL when the item was added ad hoc on this sign-up rather than inherited. */
  required_document_id: string | null;
  name: string;
  note: string | null;
  status: DocumentStatus;
  file_url: string | null;
  waived: number;
  waived_reason: string | null;
  verified_by: string | null;
  verified_at: string | null;
  sort_order: number;
}

export interface RequiredDocumentRow {
  id: string;
  edition: Edition;
  /** NULL = applies to every programme in the edition. */
  program_id: string | null;
  cohort_id: string | null;
  name: string;
  note: string | null;
  mandatory: number;
  active: number;
  sort_order: number;
}

export interface AgreementTemplateRow {
  id: string;
  edition: Edition;
  code: string;
  name: string;
  file_name: string | null;
  file_url: string | null;
  version: string;
  status: AgreementStatus;
  stage: AgreementStage;
  created_at: string;
}

export interface AgreementTemplateFieldRow {
  id: string;
  template_id: string;
  key: string;
  label: string;
  sample: string | null;
  sort_order: number;
}

export interface AgreementTemplateProgramRow {
  template_id: string;
  program_id: string;
}

export interface AgreementFlowStepRow {
  id: string;
  template_id: string;
  step_index: number;
  /** A role id, or the literal `founder`. */
  actor_role: string;
  action: AgreementFlowAction;
}

export interface AgreementRow {
  id: string;
  signup_id: string;
  template_id: string | null;
  kind: string;
  template_url: string | null;
  merge_values_json: string | null;
  status: AgreementStatus;
  /** Locked once the founder signs (spec §8.3). */
  method_locked: number;
  countersigned_by: string | null;
  countersigned_at: string | null;
  created_at: string;
}

export interface SignatureRow {
  id: string;
  agreement_id: string;
  signer_user_id: string | null;
  /** Founder signers have no `users` row; their email identifies them. */
  signer_email: string | null;
  signer_name: string | null;
  method_provider: SigningProvider | null;
  sig_type: SignatureType | null;
  /**
   * §1.3 — the provider is stubbed. This is the reference the stub records, or
   * the real envelope id once a provider is configured. No credential, no SDK.
   */
  provider_reference: string | null;
  signed_at: string | null;
  created_at: string;
}

/** `authorised_signatories`: grant by role, by named individual, or both. */
export interface AuthorisedSignatoryRow {
  id: string;
  edition: Edition;
  /** Exactly one of these is set. */
  role: Role | null;
  user_id: string | null;
  enabled: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. CRM connections (migration 0037)
// ═══════════════════════════════════════════════════════════════════════════

export const CRM_PROVIDERS = ["salesforce", "hubspot", "pipedrive", "custom"] as const;
export type CrmProvider = (typeof CRM_PROVIDERS)[number];

export const CRM_PROVIDER_LABELS: Record<CrmProvider, string> = {
  salesforce: "Salesforce",
  hubspot: "HubSpot",
  pipedrive: "Pipedrive",
  custom: "Custom API",
};

export const CRM_STATUSES = ["live", "inactive", "error"] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];

export interface CrmConnectionRow {
  id: string;
  edition: Edition;
  provider: CrmProvider;
  status: CrmStatus;
  /**
   * §1.3 — interface-complete, provider-stubbed. Non-secret settings only: the
   * instance/base URL and the webhook path. Credentials live in Worker secrets,
   * never in D1, so nothing here can leak a token.
   */
  base_url: string | null;
  webhook_path: string | null;
  trigger_field: string | null;
  trigger_value: string | null;
  monthly_deck_cap: number | null;
  score_writeback_field: string | null;
  auto_approve_within_cap: number;
  write_back_scores: number;
  last_sync_at: string | null;
  last_sync_count: number | null;
  last_error: string | null;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Seats (migration 0036)
// ═══════════════════════════════════════════════════════════════════════════

export interface CohortSeatFields {
  seat_capacity: number;
  seats_filled: number;
}

/** Utilisation as the seat-capacity table renders it; 0 capacity reads as 0 %. */
export function seatUtilisation(capacity: number, filled: number): number {
  return capacity > 0 ? Math.round((filled / capacity) * 100) : 0;
}
