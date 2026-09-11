/**
 * CRM sync — the vocabulary and the field-mapping rules, shared by the server
 * (`src/server/crm/**`, `src/server/routes/crm.ts`) and the Admin console
 * section (`src/client/routes/admin/CrmSync.tsx`).
 *
 * Pure: no `Env`, no DB, no `fetch`. That is what lets the console pre-validate
 * a mapping set with the exact rules the route enforces, and what lets
 * `validateMappings` unit-test at the node tier.
 *
 * The Env-bound half — the provider interface, the recording stub and the
 * connection store — is `src/server/crm/`.
 */

import { REQUIRED_INTAKE_FIELDS, INTAKE_FIELD_LABELS } from "./intake";

export const CRM_PROVIDERS = ["salesforce", "hubspot", "pipedrive", "custom"] as const;
export type CrmProvider = (typeof CRM_PROVIDERS)[number];

/** Prototype order and labels — the four `.crm-item` rows of `s-crm.html`. */
export const CRM_PROVIDER_LABELS: Record<CrmProvider, string> = {
  salesforce: "Salesforce",
  hubspot: "HubSpot",
  pipedrive: "Pipedrive",
  custom: "Custom API",
};

/** `.crm-sub` for a provider that has never been connected. */
export const CRM_PROVIDER_BLURBS: Record<CrmProvider, string> = {
  salesforce: "Not connected",
  hubspot: "Not connected",
  pipedrive: "Not connected",
  custom: "Connect any CRM via webhook or REST API",
};

export const CRM_STATUSES = ["live", "inactive", "error"] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];

/** Which way records move for the connection as a whole. */
export const CRM_DIRECTIONS = ["pull", "push", "both"] as const;
export type CrmDirection = (typeof CRM_DIRECTIONS)[number];

export const CRM_DIRECTION_LABELS: Record<CrmDirection, string> = {
  pull: "Pull deals into ai.STARTUPJURY",
  push: "Push evaluation results to the CRM",
  both: "Two-way — pull deals and write scores back",
};

export const CRM_SCHEDULES = ["manual", "hourly", "daily", "weekly"] as const;
export type CrmSchedule = (typeof CRM_SCHEDULES)[number];

export const CRM_SCHEDULE_LABELS: Record<CrmSchedule, string> = {
  manual: "Manual — only when someone runs a sync",
  hourly: "Every hour",
  daily: "Once a day",
  weekly: "Once a week",
};

/** Which way one mapped field moves. */
export const CRM_MAPPING_DIRECTIONS = ["inbound", "outbound"] as const;
export type CrmMappingDirection = (typeof CRM_MAPPING_DIRECTIONS)[number];

/**
 * A recorded sync attempt's outcome, mirroring `EmailStatus`:
 *
 *   'recorded' — no provider client configured, so the attempt was audited and
 *                nothing left the Worker. The ONLY status this build produces
 *                (§1.3), and deliberately not reported as 'sent'.
 *   'sent'     — a configured provider accepted the call.
 *   'failed'   — a call was attempted and threw; the reason lands in `error`.
 *   'skipped'  — a precondition said not to try (write-back off, cap reached).
 */
export const CRM_SYNC_STATUSES = ["recorded", "sent", "failed", "skipped"] as const;
export type CrmSyncStatus = (typeof CRM_SYNC_STATUSES)[number];

export const CRM_OPERATIONS = ["pull_deals", "write_back_score"] as const;
export type CrmOperation = (typeof CRM_OPERATIONS)[number];

export function isCrmProvider(v: unknown): v is CrmProvider {
  return typeof v === "string" && (CRM_PROVIDERS as readonly string[]).includes(v);
}

export function isCrmDirection(v: unknown): v is CrmDirection {
  return typeof v === "string" && (CRM_DIRECTIONS as readonly string[]).includes(v);
}

export function isCrmSchedule(v: unknown): v is CrmSchedule {
  return typeof v === "string" && (CRM_SCHEDULES as readonly string[]).includes(v);
}

export function isCrmMappingDirection(v: unknown): v is CrmMappingDirection {
  return typeof v === "string" && (CRM_MAPPING_DIRECTIONS as readonly string[]).includes(v);
}

/** One CRM field ↔ app field pair. */
export interface CrmFieldMapping {
  crmField: string;
  appField: string;
  direction: CrmMappingDirection;
}

/** Non-secret connection settings plus the prototype's filter-rule card. */
export interface CrmConnectionView {
  provider: CrmProvider;
  label: string;
  status: CrmStatus;
  /** `.crm-sub` — "Last sync: … · 3 deals pulled", or the not-connected blurb. */
  summary: string;
  baseUrl: string | null;
  webhookPath: string | null;
  syncDirection: CrmDirection;
  syncSchedule: CrmSchedule;
  triggerField: string | null;
  triggerValue: string | null;
  monthlyDeckCap: number | null;
  scoreWritebackField: string | null;
  autoApproveWithinCap: boolean;
  writeBackScores: boolean;
  lastSyncAt: string | null;
  lastSyncCount: number | null;
  lastError: string | null;
  connectedAt: string | null;
  /**
   * Credential PRESENCE, never the credential. `hint` is a masked tail the
   * operator can recognise ("••••4f2a"); `ref` names the Worker secret a live
   * deployment reads. Nothing here can be replayed as a credential.
   */
  credential: { configured: boolean; hint: string | null; ref: string | null; setAt: string | null };
  mappings: CrmFieldMapping[];
}

/** One row of the sync log, as the section's telemetry list renders it. */
export interface CrmSyncLogView {
  id: string;
  provider: CrmProvider;
  direction: string;
  operation: CrmOperation;
  status: CrmSyncStatus;
  deckId: string | null;
  recordCount: number;
  payload: unknown;
  error: string | null;
  createdAt: string;
}

// ── Field mapping ────────────────────────────────────────────────────────────

/**
 * App-side fields a CRM field may map onto.
 *
 * Inbound: the deck name plus the five required intake columns
 * (`REQUIRED_INTAKE_FIELDS`) — exactly what `POST /api/decks` collects, so a
 * pulled deal produces a deck that is Complete rather than Incomplete.
 * Outbound: what an evaluation produces and the CRM wants back.
 */
export const APP_FIELDS: Record<CrmMappingDirection, readonly string[]> = {
  inbound: ["companyName", ...REQUIRED_INTAKE_FIELDS, "stage", "deckUrl"],
  outbound: ["aiScore", "compositeScore", "signal", "status", "reportUrl"],
};

export const APP_FIELD_LABELS: Record<string, string> = {
  companyName: "Company / deck name",
  ...INTAKE_FIELD_LABELS,
  stage: "Funding stage",
  deckUrl: "Pitchdeck file URL",
  aiScore: "AI score",
  compositeScore: "Composite score",
  signal: "Signal band",
  status: "Pipeline status",
  reportUrl: "Evaluation report URL",
};

/** Longest CRM field path we accept — Salesforce's own limit is far below this. */
export const MAX_CRM_FIELD_LENGTH = 120;

export type MappingError =
  | "not_an_array"
  | "too_many"
  | "missing_crm_field"
  | "crm_field_too_long"
  | "invalid_crm_field"
  | "unknown_app_field"
  | "invalid_direction"
  | "duplicate_app_field"
  | "duplicate_crm_field";

export interface MappingResult {
  ok: boolean;
  error?: MappingError;
  /** Which entry failed, so the editor can mark the row. */
  index?: number;
  detail?: string;
  mappings: CrmFieldMapping[];
}

const MAX_MAPPINGS = 40;

/**
 * A CRM field is an identifier path: `Account.BillingCity`, `AI_Score__c`,
 * `properties.dealstage`. Anything with whitespace, quotes or punctuation that
 * could change the meaning of a provider query is refused rather than escaped —
 * the value ends up inside a SOQL/REST field list in a live deployment.
 */
const CRM_FIELD_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;

function fail(error: MappingError, index?: number, detail?: string): MappingResult {
  return { ok: false, error, index, detail, mappings: [] };
}

/**
 * Normalise and validate a mapping set. Rejects, in this order: a non-array; a
 * set over the cap; a blank or over-long CRM field; a CRM field that is not an
 * identifier path; an app field outside `APP_FIELDS` for that direction; a bad
 * direction; and — the two that make a mapping ambiguous rather than merely
 * wrong — the same app field twice in one direction, or the same CRM field
 * twice in one direction.
 */
export function validateMappings(input: unknown): MappingResult {
  if (!Array.isArray(input)) return fail("not_an_array");
  if (input.length > MAX_MAPPINGS) return fail("too_many", undefined, `max ${MAX_MAPPINGS}`);

  const out: CrmFieldMapping[] = [];
  const seenApp = new Set<string>();
  const seenCrm = new Set<string>();

  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as Partial<CrmFieldMapping> | null;
    const direction = raw?.direction ?? "inbound";
    if (!isCrmMappingDirection(direction)) return fail("invalid_direction", i, String(direction));

    const crmField = typeof raw?.crmField === "string" ? raw.crmField.trim() : "";
    if (!crmField) return fail("missing_crm_field", i);
    if (crmField.length > MAX_CRM_FIELD_LENGTH) return fail("crm_field_too_long", i, crmField);
    if (!CRM_FIELD_RE.test(crmField)) return fail("invalid_crm_field", i, crmField);

    const appField = typeof raw?.appField === "string" ? raw.appField.trim() : "";
    if (!APP_FIELDS[direction].includes(appField)) return fail("unknown_app_field", i, appField);

    const appKey = `${direction}:${appField}`;
    if (seenApp.has(appKey)) return fail("duplicate_app_field", i, appField);
    seenApp.add(appKey);

    // Case-insensitive: `AI_Score__c` and `ai_score__c` are the same CRM field.
    const crmKey = `${direction}:${crmField.toLowerCase()}`;
    if (seenCrm.has(crmKey)) return fail("duplicate_crm_field", i, crmField);
    seenCrm.add(crmKey);

    out.push({ crmField, appField, direction });
  }

  return { ok: true, mappings: out };
}

/** Human message for a validation failure — reused by the route and the editor. */
export function describeMappingError(r: MappingResult): string {
  const at = r.index === undefined ? "" : ` (row ${r.index + 1})`;
  switch (r.error) {
    case "not_an_array":
      return "Field mappings must be a list.";
    case "too_many":
      return `Too many field mappings — ${MAX_MAPPINGS} is the limit.`;
    case "missing_crm_field":
      return `Every mapping needs a CRM field${at}.`;
    case "crm_field_too_long":
      return `That CRM field name is too long${at}.`;
    case "invalid_crm_field":
      return `"${r.detail}" is not a valid CRM field name${at} — use Account.Name or AI_Score__c.`;
    case "unknown_app_field":
      return `"${r.detail}" is not a field this app can map${at}.`;
    case "invalid_direction":
      return `Mapping direction must be inbound or outbound${at}.`;
    case "duplicate_app_field":
      return `"${APP_FIELD_LABELS[r.detail ?? ""] ?? r.detail}" is mapped twice${at}.`;
    case "duplicate_crm_field":
      return `CRM field "${r.detail}" is mapped twice${at}.`;
    default:
      return "Field mappings are not valid.";
  }
}
